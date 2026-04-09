import asyncio
import os
import uuid
import jwt
import logging
import time  
from typing import Optional
from contextlib import asynccontextmanager 

from fastapi import FastAPI, HTTPException, Depends, Header, Request  
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel, Field
from dotenv import load_dotenv
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
import httpx

# LangChain imports 
from langchain_core.messages import HumanMessage, AIMessage

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv() 

from RAGengine import RuleSearchEngine
from database import ChatDatabase  

# --- INITIALIZE SERVICES --- 
db_service = ChatDatabase()
engine = RuleSearchEngine(db=db_service.db)

# --- CLERK JWT CONFIGURATION ---
CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL") 
CLERK_ISSUER = os.getenv("CLERK_ISSUER")  

class JWKSCache:
    
    def __init__(self, jwks_url: str):
        self.jwks_url = jwks_url
        self.keys = {}
        self.last_refresh = 0
        self._refresh_lock = asyncio.Lock()
        self.min_refresh_interval = 10  

    async def get_key(self, kid: str):
       
        if kid in self.keys:
            return self.keys[kid]
        await self.refresh_keys()
        return self.keys.get(kid)

    async def refresh_keys(self):
        async with self._refresh_lock:
            current_time = time.time()
            if current_time - self.last_refresh < self.min_refresh_interval:
                logger.warning("Skipping JWKS refresh due to rate limiting.")
                return

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(self.jwks_url)
                response.raise_for_status()
                jwks = response.json()
                
                new_keys = {}
                for key in jwks.get("keys", []):
                    kid = key.get("kid")
                    if kid:
                        new_keys[kid] = jwt.algorithms.RSAAlgorithm.from_jwk(key)
                
                self.keys = new_keys
                self.last_refresh = current_time
                logger.info(f"Successfully refreshed {len(self.keys)} Clerk public keys")
        except Exception as e:
            logger.error(f"Failed to fetch Clerk public keys: {str(e)}")

jwks_cache = JWKSCache(CLERK_JWKS_URL)


@asynccontextmanager
async def lifespan(app: FastAPI):
 
    logger.info("Starting up application...")
    await db_service.ensure_indexes()
    await jwks_cache.refresh_keys()   
    yield
    
    logger.info("Shutting down application...")

    try:
        db_service.close()  
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")

# --- APP DEFINITION ---
app = FastAPI(title="BU Chatbot API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "").split(","),  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"], 
)

templates = Jinja2Templates(directory="static")

# --- API MODELS ---
class ChatMessage(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000, description="User query text")
    session_id: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    session_id: str

# --- AUTHENTICATION ---
async def get_current_user_id(authorization: str = Header(None)) -> str:
    """Extract user_id from Clerk JWT token with signature verification"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header missing")
    
    try:
        token = authorization.replace("Bearer ", "")
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        
        if not kid:
            raise HTTPException(status_code=401, detail="Invalid token: no key ID")
        
        public_key = await jwks_cache.get_key(kid)
            
        if not public_key:
            raise HTTPException(status_code=401, detail="Invalid token: unknown key ID or key rotation occurred")
        
        decoded = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            issuer=CLERK_ISSUER,
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_iss": True,
                "require": ["exp", "iss", "sub"]
            }
        )
        
        user_id = decoded.get("sub")
        
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: no user ID")
        
        return user_id
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidIssuerError:
        raise HTTPException(status_code=401, detail="Invalid token issuer")
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid token: {str(e)}")
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        logger.error(f"Authentication error: {str(e)}")
        raise HTTPException(status_code=401, detail="Authentication failed")

# --- HELPER FUNCTIONS ---
async def get_formatted_history(session_id: str, user_id: str):
    
    if not session_id:
        return []
        
    db_messages = await db_service.get_chat_history(session_id, user_id)
    formatted_history = []
    
    for msg in db_messages:
        if msg["role"] == "user":
            formatted_history.append(HumanMessage(content=msg["content"]))
        else:
            formatted_history.append(AIMessage(content=msg["content"]))
            
    return formatted_history

# --- API ENDPOINTS ---

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    clerk_key = os.getenv("CLERK_PUBLISHABLE_KEY")
    return templates.TemplateResponse("index.html", {
        "request": request,
        "clerk_publishable_key": clerk_key
    })

@app.post("/api/chat", response_model=ChatResponse)
async def chat(msg: ChatMessage, user_id: str = Depends(get_current_user_id)):
    session_id = msg.session_id

    if not session_id or not await db_service.get_session(session_id, user_id):
        session_id = str(uuid.uuid4())
        try:
            title = await engine.generate_chat_title(msg.message)
        except Exception as e:
            logger.warning(f"Failed to generate chat title: {str(e)}")
            title = msg.message[:30] + "..."
            
        await db_service.create_session(session_id, title, user_id)
    
    history_chain = await get_formatted_history(session_id, user_id)

    try:
        response = await engine.ask(
            msg.message, 
            chat_history=history_chain
        )
        
        await db_service.add_message(session_id, user_id, "user", msg.message)
        await db_service.add_message(session_id, user_id, "assistant", response)
        
        return ChatResponse(response=response, session_id=session_id)
        
    except Exception as e:
        logger.error(f"Error generating response for user {user_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, 
            detail="An error occurred while processing your request. Please try again later."
        )

@app.post("/api/new-chat")
async def new_chat(user_id: str = Depends(get_current_user_id)):
    """Start a new chat session"""
    return {"status": "ok", "message": "New chat started"}

@app.get("/api/chats")
async def get_chats(user_id: str = Depends(get_current_user_id)):
    """Get all chat sessions for the current user"""
    try:
        return {"chats": await db_service.list_sessions(user_id)}
    except Exception as e:
        logger.error(f"Error fetching chats for user {user_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve chat sessions. Please try again later."
        )

@app.get("/api/chats/{session_id}")
async def get_chat(session_id: str, user_id: str = Depends(get_current_user_id)):
    try:
        session = await db_service.get_session(session_id, user_id)
        if not session:
            raise HTTPException(status_code=404, detail="Chat not found")
        
        history_messages = await db_service.get_chat_history(session_id, user_id)
        
        formatted_messages = []
        for msg in history_messages:
            formatted_messages.append({
                "role": msg["role"],
                "content": msg["content"],
                "timestamp": msg["timestamp"].isoformat()
            })
        
        return {
            "id": session_id,
            "title": session["title"],
            "created_at": session["created_at"].isoformat(),
            "messages": formatted_messages
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching chat {session_id} for user {user_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve chat session. Please try again later."
        )

@app.delete("/api/chats/{session_id}")
async def delete_chat(session_id: str, user_id: str = Depends(get_current_user_id)):
    try:
        if not await db_service.get_session(session_id, user_id):
            raise HTTPException(status_code=404, detail="Chat not found")
        
        await db_service.delete_session(session_id, user_id)
        
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting chat {session_id} for user {user_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to delete chat session. Please try again later."
        )

app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=80)
    