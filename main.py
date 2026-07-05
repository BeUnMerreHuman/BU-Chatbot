import asyncio
import os
import uuid
import jwt
import logging
import time  
import json
from typing import Optional
from contextlib import asynccontextmanager 

from fastapi import FastAPI, HTTPException, Depends, Header, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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

# --- AUTHENTICATION ---
async def verify_clerk_token(token: str) -> str:
    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            raise ValueError("Invalid token: no key ID")
        
        public_key = await jwks_cache.get_key(kid)
        if not public_key:
            raise ValueError("Invalid token: unknown key ID")
        
        decoded = jwt.decode(
            token, public_key, algorithms=["RS256"], issuer=CLERK_ISSUER,
            options={"verify_signature": True, "verify_exp": True, "verify_iss": True, "require": ["exp", "iss", "sub"]},
            leeway=10
        )
        return decoded.get("sub")
    except Exception as e:
        logger.error(f"Token verification failed: {e}")
        return None

async def get_current_user_id(authorization: str = Header(None)) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header missing")
    
    token = authorization.replace("Bearer ", "")
    user_id = await verify_clerk_token(token)
    
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication failed")
        
    return user_id

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

# --- WEBSOCKET ENDPOINT ---
@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket, token: str = Query(...), session_id: Optional[str] = Query(None)):
    await websocket.accept()
    
    user_id = await verify_clerk_token(token)
    if not user_id:
        await websocket.send_text("Error: Unauthorized")
        await websocket.close(code=1008)
        return

    try:
        while True:
            # 2. Wait for user message (expecting JSON payload now)
            raw_data = await websocket.receive_text()
            try:
                payload = json.loads(raw_data)
                user_message = payload.get("content", "")
                user_msg_id = payload.get("id", str(uuid.uuid4()))
                assistant_msg_id = payload.get("assistant_id", str(uuid.uuid4()))
            except json.JSONDecodeError:
                user_message = raw_data
                user_msg_id = str(uuid.uuid4())
                assistant_msg_id = str(uuid.uuid4())
            
            # 3. Handle Session
            current_session = session_id
            session_data = await db_service.get_session(current_session, user_id) if current_session else None
            
            if not session_data:
                current_session = str(uuid.uuid4())
                try:
                    title = await engine.generate_chat_title(user_message)
                except Exception as e:
                    logger.warning(f"Failed to generate chat title: {str(e)}")
                    title = user_message[:30] + "..."
                    
                await db_service.create_session(current_session, title, user_id)
                await websocket.send_text(f"[SESSION_ID:{current_session}]")
            elif session_data.get("title") == "New Chat":
                try:
                    new_title = await engine.generate_chat_title(user_message)
                    await db_service.update_session_title(current_session, user_id, new_title)
                except Exception as e:
                    logger.warning(f"Failed to update chat title: {str(e)}")
            
            # 4. Stream Response
            history_chain = await get_formatted_history(current_session, user_id)
            full_response = ""
            
            async for chunk in engine.ask_stream(user_message, history_chain):
                await websocket.send_text(chunk)
                full_response += chunk
                
            await websocket.send_text("[END]")
            
            # 5. Save to DB post-stream with designated IDs
            await db_service.add_message(current_session, user_id, "user", user_message, user_msg_id)
            await db_service.add_message(current_session, user_id, "assistant", full_response, assistant_msg_id)
            
    except WebSocketDisconnect:
        logger.info(f"User {user_id} disconnected from WebSocket")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        await websocket.send_text("[END]")
        await websocket.close()

# --- REST API ENDPOINTS ---
class PinUpdate(BaseModel):
    is_pinned: bool

class FeedbackUpdate(BaseModel):
    feedback: str

@app.post("/api/new-chat")
async def new_chat(user_id: str = Depends(get_current_user_id)):
    session_id = str(uuid.uuid4())
    title = "New Chat"
    await db_service.create_session(session_id, title, user_id)
    return {"id": session_id, "title": title}

@app.get("/api/chats")
async def get_chats(user_id: str = Depends(get_current_user_id)):
    try:
        return {"chats": await db_service.list_sessions(user_id)}
    except Exception as e:
        logger.error(f"Error fetching chats for user {user_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve chat sessions.")

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
                "role": msg.get("role"),
                "content": msg.get("content"),
                "timestamp": msg.get("timestamp").isoformat() if msg.get("timestamp") else None,
                "id": msg.get("id"),
                "feedback": msg.get("feedback", "none")
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
        raise HTTPException(status_code=500, detail="Failed to retrieve chat session.")

@app.patch("/api/chats/{session_id}/pin")
async def pin_chat(session_id: str, payload: PinUpdate, user_id: str = Depends(get_current_user_id)):
    """Toggle the pin status of a specific chat."""
    try:
        await db_service.toggle_pin(session_id, user_id, payload.is_pinned)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error pinning chat: {e}")
        raise HTTPException(status_code=500, detail="Failed to pin chat.")

@app.patch("/api/chats/{session_id}/messages/{message_id}/feedback")
async def update_feedback(session_id: str, message_id: str, payload: FeedbackUpdate, user_id: str = Depends(get_current_user_id)):
    """Update feedback (likes/dislikes) for a specific message."""
    try:
        success = await db_service.update_message_feedback(session_id, user_id, message_id, payload.feedback)
        if not success:
            raise HTTPException(status_code=404, detail="Message not found")
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating feedback: {e}")
        raise HTTPException(status_code=500, detail="Failed to update feedback.")

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
        raise HTTPException(status_code=500, detail="Failed to delete chat session.")

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)