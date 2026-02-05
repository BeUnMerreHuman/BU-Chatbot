import os
import json
import shutil
import kagglehub
import pymongo
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from typing import List, Dict, Any, Optional
from pymongo.errors import CollectionInvalid


# --- CONFIGURATION ---
load_dotenv()

ATLAS_CONNECTION_STRING = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("DB_NAME")
VECTOR_COLLECTION_NAME = os.getenv("VECTOR_COLLECTION_NAME")

def download_kaggle_dataset(dataset_name, destination_folder, file_extension):

    print(f"Downloading dataset: {dataset_name}...")
    path = kagglehub.dataset_download(dataset_name)
    print(f"Download complete. Cache path: {path}")
    
    # Set up the destination folder
    current_directory = os.getcwd()
    dest_path = os.path.join(current_directory, destination_folder)
    
    if not os.path.exists(dest_path):
        os.makedirs(dest_path)
    
    # Normalize extension (ensure it starts with a dot)
    if not file_extension.startswith('.'):
        file_extension = '.' + file_extension
    
    # Find the first file with matching extension
    source_file_path = None
    for root, dirs, files in os.walk(path):
        for file in files:
            if file.lower().endswith(file_extension.lower()):
                source_file_path = os.path.join(root, file)
                break
        if source_file_path:
            break
    
    # Move the file if found
    if source_file_path:
        file_name = os.path.basename(source_file_path)
        destination_path = os.path.join(dest_path, file_name)
        
        # Overwrite if exists
        if os.path.exists(destination_path):
            os.remove(destination_path)
        
        shutil.move(source_file_path, destination_path)
        print(f"✅ Success! Moved '{file_name}' to '{destination_folder}'")
        return destination_path
    else:
        print(f"❌ No {file_extension} file was found in the downloaded directory.")
        return None

# --- HELPER FUNCTIONS ---
def json_to_markdown(table_obj: Any) -> str:
    """Convert table JSON to markdown format for better LLM understanding"""
    if not table_obj:
        return ""
    
    cols = []
    rows = []
    
    # Case 1: Handle List of Dictionaries
    if isinstance(table_obj, list):
        if len(table_obj) == 0:
            return ""
        cols = list(table_obj[0].keys())
        rows = [[str(item.get(col, "")) for col in cols] for item in table_obj]

    # Case 2: Handle Dictionary with 'columns'/'rows' keys
    elif isinstance(table_obj, dict):
        cols = table_obj.get('columns', [])
        raw_rows = table_obj.get('rows', [])
        rows = [[str(cell) for cell in row] for row in raw_rows]
    
    else:
        return ""
    
    if not cols or not rows:
        return ""
    
    header = "| " + " | ".join(cols) + " |"
    separator = "| " + " | ".join(["---"] * len(cols)) + " |"
    body = "\n".join(["| " + " | ".join(row) for row in rows])
    
    return f"{header}\n{separator}\n{body}"

class AtlasUnifiedManager:
    def __init__(self):
        if not ATLAS_CONNECTION_STRING:
            raise ValueError("MONGODB_URI not found in environment variables.")
        
        # 1. Connect to Atlas
        self.client = pymongo.MongoClient(ATLAS_CONNECTION_STRING)
        self.db = self.client[DB_NAME]
        print(f"Connected to Database: {DB_NAME}")

    def initialize_chat_schema(self):
        """
        Creates chat_sessions and chat_messages collections with validators 
        and indexes ONLY if they do not exist.
        """
        existing_collections = self.db.list_collection_names()
        
        # --- 1. Chat Sessions Collection ---
        if "chat_sessions" not in existing_collections:
            print("Creating 'chat_sessions' collection with schema validation...")
            try:
                self.db.create_collection("chat_sessions", validator={
                    "$jsonSchema": {
                        "bsonType": "object",
                        "required": ["_id", "userId", "title", "created_at"],
                        "properties": {
                            "_id": {"bsonType": "string"},
                            "userId": {"bsonType": "string"},
                            "title": {"bsonType": "string"},
                            "created_at": {"bsonType": "date"}
                        }
                    }
                })
                # Index: Efficiently find ALL sessions for User X, sorted by newest first
                self.db["chat_sessions"].create_index([("userId", 1), ("created_at", -1)])
                print("✔ 'chat_sessions' created successfully.")
            except Exception as e:
                print(f"Error creating chat_sessions: {e}")
        else:
            print("➡ 'chat_sessions' already exists. Skipping creation.")

        # --- 2. Chat Messages Collection ---
        if "chat_messages" not in existing_collections:
            print("Creating 'chat_messages' collection with schema validation...")
            try:
                self.db.create_collection("chat_messages", validator={
                    "$jsonSchema": {
                        "bsonType": "object",
                        "required": ["sessionId", "userId", "bucketId", "count", "messages"],
                        "properties": {
                            "sessionId": {"bsonType": "string"},
                            "userId": {"bsonType": "string"},
                            "bucketId": {"bsonType": "int"},
                            "count": {"bsonType": "int", "maximum": 50},
                            "messages": {
                                "bsonType": "array",
                                "items": {
                                    "bsonType": "object",
                                    "required": ["role", "content", "timestamp"],
                                    "properties": {
                                        "role": {"enum": ["user", "assistant"]},
                                        "content": {"bsonType": "string"},
                                        "timestamp": {"bsonType": "date"}
                                    }
                                }
                            }
                        }
                    }
                })
                # Index: Find buckets belonging to a specific Session AND specific User
                self.db["chat_messages"].create_index([
                    ("userId", 1), 
                    ("sessionId", 1), 
                    ("bucketId", 1)
                ])
                print("✔ 'chat_messages' created successfully.")
            except Exception as e:
                print(f"Error creating chat_messages: {e}")
        else:
            print("➡ 'chat_messages' already exists. Skipping creation.")

    def ingest_vectors(self, file_path: str):
        """Reads JSON file, vectorizes content, and uploads to 'rules' collection."""
        
        if not os.path.exists(file_path):
            print(f"Error: File {file_path} not found.")
            return

        # Load model only when needed to save resources during schema checks
        print("Loading embedding model...")
        model = SentenceTransformer("all-MiniLM-L6-v2")
        print("Model loaded.")

        with open(file_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)
        
        print(f"Processing {len(raw_data)} documents for vector store...")
        
        documents_to_upload = []
        
        for index, entry in enumerate(raw_data):
            # ... (Logic identical to your original script) ...
            
            # CASE 1: Rule with Exceptions
            if "rule_id" in entry:
                doc_id = entry["rule_id"]
                base_text = entry.get("description", "")
                exceptions_text = ""
                if "exceptions" in entry and isinstance(entry["exceptions"], list):
                    for exc in entry["exceptions"]:
                        sub_id = exc.get("id", "")
                        sub_desc = exc.get("description", "")
                        exceptions_text += f"\n- Exception {sub_id}: {sub_desc}"
                searchable_text = f"{base_text}\n{exceptions_text}"

            # CASE 2: Standard Document
            elif "id" in entry:
                doc_id = entry["id"]
                searchable_text = entry.get("document", "")
            
            else:
                continue

            md_table = json_to_markdown(entry.get("table"))
            if md_table:
                searchable_text += f"\n\n{md_table}"
            
            if not searchable_text.strip():
                continue
            
            vector = model.encode(searchable_text).tolist()
            
            mongo_doc = {
                "_id": doc_id, 
                "text_content": searchable_text,
                "metadata": entry.get("metadata"),
                "raw_table": entry.get("table"),
                "markdown_table": md_table,
                "embedding": vector,
                "doc_type": "rule" if "rule_id" in entry else "standard" 
            }
            documents_to_upload.append(mongo_doc)
        
        # --- UPLOAD ---
        # Note: We overwrite vector data because this is a "Knowledge Base sync"
        col = self.db[VECTOR_COLLECTION_NAME]
        deleted_count = col.delete_many({}).deleted_count
        print(f"Cleaned {deleted_count} old documents from '{VECTOR_COLLECTION_NAME}'.")
        
        if documents_to_upload:
            try:
                col.insert_many(documents_to_upload)
                print(f"✔ Successfully uploaded {len(documents_to_upload)} vectors!")
            except pymongo.errors.BulkWriteError as bwe:
                print("Error uploading data:", bwe.details)
        else:
            print("No documents generated for upload.")

if __name__ == "__main__":
    download_kaggle_dataset("muneeburrehman98/bu-student-rulebook-spring-2025-structured-json", "data", ".json")

    manager = AtlasUnifiedManager()
    
    # 1. Run Schema Setup (Idempotent - Safe to run multiple times)
    print("--- 1. Initializing Chat Schema ---")
    manager.initialize_chat_schema()
    
    # 2. Run Vector Ingestion (Refreshes the knowledge base)
    print("\n--- 2. Starting Vector Ingestion ---")
    manager.ingest_vectors("data\\BU_Student_Rulebook.json")