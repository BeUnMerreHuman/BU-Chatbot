import os
import re
import asyncio
from dotenv import load_dotenv
from fastembed import TextEmbedding

# --- LANGCHAIN IMPORTS ---
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
VECTOR_INDEX_NAME = os.getenv("VECTOR_INDEX_NAME")
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

class RuleSearchEngine:
    def __init__(self, db, verbose=False):
        """
        Initialize the Async Rule Search Engine
        
        Args:
            db: The Motor database instance (from database.py)
            verbose: Print debug logs
        """
        self.verbose = verbose
        self.db = db
        self.collection = self.db["rules"] 
        
        if self.verbose: print("Loading embedding model...")
        cache_path = os.path.join(os.path.dirname(__file__), "model_cache")
        self.embedding_model = TextEmbedding(
            model_name=MODEL_NAME, 
            cache_dir=cache_path
        )
        self.embedding_model = TextEmbedding(model_name=MODEL_NAME)

        if self.verbose: print("Initializing Groq...")
        self.llm = ChatGroq(
            temperature=0, 
            model_name="llama-3.1-8b-instant", 
            api_key=GROQ_API_KEY
        )

    async def search(self, query: str, limit: int = 3):
        """Async Search using Motor"""
        
        rule_match = re.search(r"rule\s+([\d\.]+)", query, re.IGNORECASE)
        if rule_match:
            target_rule = rule_match.group(1)
            regex_pattern = rf"^{re.escape(target_rule)}($|\.)"
            cursor = self.collection.find({
                "metadata.rule_number": {"$regex": regex_pattern}
            })
            return await cursor.to_list(length=None)

        page_match = re.search(r"page\s+(\d+)", query, re.IGNORECASE)
        if page_match:
            target_page = int(page_match.group(1))
            cursor = self.collection.find({"metadata.page_number": target_page})
            return await cursor.to_list(length=None)

        query_vector = await asyncio.to_thread(self._embed_query, query)
        
        pipeline = [
            {
                "$vectorSearch": {
                    "index": VECTOR_INDEX_NAME,
                    "path": "embedding",
                    "queryVector": query_vector,
                    "numCandidates": 50,
                    "limit": limit
                }
            },
            {
                "$project": {
                    "_id": 1,
                    "text_content": 1,
                    "metadata": 1,
                    "score": {"$meta": "vectorSearchScore"}
                }
            }
        ]
        
        try:
            cursor = self.collection.aggregate(pipeline)
            return await cursor.to_list(length=None)
        except Exception as e:
            if self.verbose: print(f"Error in vector search: {e}")
            return []

    def _embed_query(self, query):
        """Helper to run synchronous embedding in a thread"""
        generator = self.embedding_model.embed([query])
        return list(generator)[0].tolist()

    async def contextualize_query(self, user_input: str, chat_history: list):
        if not chat_history:
            return user_input

        contextualize_q_system_prompt = (
            "Given a chat history and the latest user question "
            "which might reference context in the chat history, "
            "formulate a standalone question which can be understood "
            "without the chat history. Do NOT answer the question, "
            "just reformulate it if needed and otherwise return it as is."
        )
        
        prompt = ChatPromptTemplate.from_messages([
            ("system", contextualize_q_system_prompt),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ])

        chain = prompt | self.llm | StrOutputParser()
        
        return await chain.ainvoke({
            "chat_history": chat_history,
            "input": user_input
        })

    async def generate_answer(self, user_query: str, documents: list, chat_history: list):
    
        context_text = ""
        if not documents:
            context_text = "No specific rules found in the database."
        else:    
            for doc in documents:
                meta = doc.get('metadata', {})
                rule = meta.get('rule_number', 'N/A')
                page = meta.get('page_number', 'N/A')
                content = doc.get('text_content', '').strip()
                context_text += f"[Source: Rule {rule}, Page {page}]: {content}\n\n"
        
        qa_system_prompt = (
            "You are an assistant for question-answering tasks. "
            "Use the following pieces of retrieved context to answer "
            "the question. If you don't know the answer, say that you "
            "don't know. Dont answer questions that are not related to the context. Always use the provided context to answer and do not rely on any prior knowledge."
            "ALWAYS cite the specific Rule Number or Page Number associated "
            "with the information in your answer.\n\n"
            "CONTEXT:\n{context}"
        )

        prompt = ChatPromptTemplate.from_messages([
            ("system", qa_system_prompt),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ])

        chain = prompt | self.llm | StrOutputParser()

        response = await chain.ainvoke({
            "chat_history": chat_history,
            "context": context_text,
            "input": user_query
        })

        return response, context_text

    async def ask(self, user_input: str, chat_history: list = None):
      
        if chat_history is None:
            chat_history = []
        
        standalone_query = await self.contextualize_query(user_input, chat_history)
        docs = await self.search(standalone_query)
        answer, _ = await self.generate_answer(user_input, docs, chat_history)
        
        return answer
    
    async def generate_chat_title(self, first_message: str):
        title_system_prompt = (
            "You are a helpful assistant. Generate a very short, concise "
            "title (maximum 5 words) for a chat session that starts with "
            "the following message. Do not use quotes or markdown."
        )
        prompt = ChatPromptTemplate.from_messages([
             ("system", title_system_prompt),
             ("human", "{input}")
        ])
        chain = prompt | self.llm | StrOutputParser()
        
        try:
            title = await chain.ainvoke({"input": first_message})
            return title.strip()
        except Exception:
            return first_message[:30] + "..."