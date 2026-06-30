import { Button } from "@/components/ui/button"
import { Copy, ThumbsUp, ThumbsDown, Check } from 'lucide-react'
import { useState } from "react"
import { message } from "../../interfaces/interfaces"
import { useAuth } from "@clerk/clerk-react"

interface MessageActionsProps {
  message: message
}

export function MessageActions({ message }: MessageActionsProps) {
  const { getToken } = useAuth()
  
  const [copied, setCopied] = useState(false)
  const initialLiked = (message as any).feedback === 'like'
  const initialDisliked = (message as any).feedback === 'dislike'
  
  const [liked, setLiked] = useState(initialLiked)
  const [disliked, setDisliked] = useState(initialDisliked)

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const updateFeedbackInDB = async (type: 'like' | 'dislike' | 'none') => {
    const sessionId = (message as any).sessionId;
    if (!sessionId || !message.id) return;
    
    try {
      const token = await getToken();
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      
      await fetch(`${API_URL}/api/chats/${sessionId}/messages/${message.id}/feedback`, {
        method: 'PATCH',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ feedback: type })
      });
    } catch (error) {
      console.error("Failed to update feedback", error);
    }
  }

  const handleLike = () => {
    const newState = !liked;
    setLiked(newState);
    setDisliked(false);
    updateFeedbackInDB(newState ? 'like' : 'none');
  }

  const handleDislike = () => {
    const newState = !disliked;
    setDisliked(newState);
    setLiked(false);
    updateFeedbackInDB(newState ? 'dislike' : 'none');
  }

  return (
    <div className="flex items-center space-x-1">
      <Button variant="ghost" size="icon" onClick={handleCopy}>
        {copied ? (
            <Check className="text-black dark:text-white" size={16} />
        ) : (
            <Copy className="text-gray-500" size={16} />
        )}
      </Button>
      <Button variant="ghost" size="icon" onClick={handleLike}>
        <ThumbsUp className={liked ? "text-black dark:text-white" : "text-gray-500"} size={16} />
      </Button>
      <Button variant="ghost" size="icon" onClick={handleDislike}>
        <ThumbsDown className={disliked ? "text-black dark:text-white" : "text-gray-500"} size={16} />
      </Button>
    </div>
  )
}