import { ChatInput } from "@/components/custom/chatinput";
import { PreviewMessage, ThinkingMessage } from "../../components/custom/message";
import { useScrollToBottom } from '@/components/custom/use-scroll-to-bottom';
import { useState, useRef } from "react";
import { message } from "../../interfaces/interfaces";
import { Overview } from "@/components/custom/overview";
import { Header } from "@/components/custom/header";
import { Sidebar } from "@/components/custom/sidebar";
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from "@clerk/clerk-react"; 

export function Chat() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  
  const [messagesContainerRef, messagesEndRef] = useScrollToBottom<HTMLDivElement>();
  const [messages, setMessages] = useState<message[]>([]);
  const [question, setQuestion] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  
  const [refreshSidebarTrigger, setRefreshSidebarTrigger] = useState<number>(0);
  
  const socketRef = useRef<WebSocket | null>(null);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  const loadChat = async (chatId: string) => {
    try {
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${API_URL}/api/chats/${chatId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // BULLETPROOFING: Ensure rawMessages is always an array, regardless of backend quirks
      const rawMessages = Array.isArray(data?.messages) 
        ? data.messages 
        : (Array.isArray(data) ? data : []);
      
      const history = rawMessages.map((msg: any) => ({
        content: msg?.content || "",
        role: msg?.role || "user",
        id: msg?.id || uuidv4(),
        sessionId: chatId, 
        feedback: msg?.feedback || "none"
      }));

      setMessages(history);
      setCurrentSessionId(chatId);
      
    } catch (error) {
      console.error("Failed to load chat history:", error);
      // Fallback to prevent app breaking
      setMessages([]);
    }
  };

  const handleNewChat = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${API_URL}/api/new-chat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        
        setCurrentSessionId(data.id);
        setMessages([]); 
        
        setRefreshSidebarTrigger(prev => prev + 1);
      }
    } catch (error) {
      console.error("Failed to create a new chat:", error);
    }
  };

  async function handleSubmit(text?: string) {
    if (!isLoaded || !isSignedIn || isLoading) return;

    const messageText = text || question;
    setIsLoading(true);
    
    const userMsgId = uuidv4();
    const assistantMsgId = uuidv4(); 
    
    setMessages(prev => [...prev, { 
      content: messageText, 
      role: "user", 
      id: userMsgId, 
      sessionId: currentSessionId || undefined,
      feedback: "none"
    }]);
    setQuestion("");

    try {
      const token = await getToken();
      
      if (socketRef.current) {
        socketRef.current.close();
      }

      let wsUrl = `ws://127.0.0.1:8000/ws/chat?token=${token}`;
      if (currentSessionId) {
        wsUrl += `&session_id=${currentSessionId}`;
      }

      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({
            content: messageText,
            id: userMsgId,
            assistant_id: assistantMsgId
        })); 
      };

      socket.onmessage = (event) => {
        setIsLoading(false);
        if(event.data.includes("[END]")) {
            socket.close();
            setRefreshSidebarTrigger(prev => prev + 1);
            return;
        }
        
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          const newContent = lastMessage?.role === "assistant" 
            ? lastMessage.content + event.data 
            : event.data;
          
          const newMessage = { 
            content: newContent, 
            role: "assistant", 
            id: assistantMsgId, 
            sessionId: currentSessionId || undefined,
            feedback: "none"
          };
          
          return lastMessage?.role === "assistant"
            ? [...prev.slice(0, -1), newMessage]
            : [...prev, newMessage];
        });
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        setIsLoading(false);
      };

    } catch (error) {
      console.error("Connection setup error:", error);
      setIsLoading(false);
    }
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      
      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        onSelectChat={(chatId) => {
          loadChat(chatId);
        }}
        refreshTrigger={refreshSidebarTrigger}
        activeSessionId={currentSessionId}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen bg-background transition-all duration-300">
        <Header 
          toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} 
          onNewChat={handleNewChat}
        />
        
        <div 
          className="flex-1 overflow-y-auto p-4 sm:p-6" 
          ref={messagesContainerRef}
        >
          <div className="max-w-3xl mx-auto flex flex-col gap-6 pb-4">
            
            {messages.length === 0 && <Overview />}
            
            {messages.map((m) => (
              <PreviewMessage key={m.id} message={m} />
            ))}

            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <ThinkingMessage />
            )}

            <div ref={messagesEndRef} className="shrink-0 min-h-[24px]" />
          </div>
        </div>
        
        <div className="flex mx-auto px-4 bg-background pt-2 pb-4 md:pb-6 gap-2 w-full md:max-w-3xl shrink-0">
          <ChatInput  
            question={question}
            setQuestion={setQuestion}
            onSubmit={handleSubmit}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}