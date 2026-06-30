import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  MessageCircle, 
  Trash2, 
  Search, 
  X, 
  Linkedin, 
  FileText, 
  Database, 
  Github,
  Pin,
  PinOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth, UserButton } from '@clerk/clerk-react';
import { ThemeToggle } from "./theme-toggle"; 
import logo from "../../assets/logo.png";

interface ChatSession {
  id: string;
  title: string;
  is_pinned?: boolean;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectChat?: (chatId: string) => void;
  refreshTrigger?: number; 
  activeSessionId?: string | null;
}

// How long a press has to be held before it counts as "long press" (ms)
const LONG_PRESS_MS = 450;

export function Sidebar({ isOpen, onClose, onSelectChat, refreshTrigger, activeSessionId }: SidebarProps) {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  
  // Unified action menu (used for both desktop right-click AND mobile long-press)
  const [actionMenu, setActionMenu] = useState<{
    chatId: string;
    isPinned: boolean;
    // Position only matters for desktop right-click; mobile renders as a bottom sheet
    anchor: { x: number; y: number } | null;
  } | null>(null);

  // Long-press tracking
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  
  const { getToken } = useAuth();
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  useEffect(() => {
    const handleGlobalClick = () => setActionMenu(prev => (prev?.anchor ? null : prev));
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, []);

  // Lock body scroll while the mobile sidebar overlay is open
  useEffect(() => {
    if (isOpen) {
      const previousOverflow = document.body.style.overflow;
      // Only lock on small screens; md+ sidebar is in-flow and shouldn't affect page scroll
      const isMobile = window.matchMedia('(max-width: 767px)').matches;
      if (isMobile) {
        document.body.style.overflow = 'hidden';
      }
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }
  }, [isOpen]);

  useEffect(() => {
    const loadChatHistory = async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const response = await fetch(`${API_URL}/api/chats`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          // Safe fallback to array
          setChats(Array.isArray(data?.chats) ? data.chats : []);
        }
      } catch (error) {
        console.error('Failed to load chat history:', error);
      }
    };

    loadChatHistory();
  }, [getToken, API_URL, refreshTrigger]);

  const filteredChats = useMemo(() => {
    let result = chats;
    if (searchQuery.trim()) {
      result = chats.filter(chat => 
        chat.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return result.sort((a, b) => {
        if (a.is_pinned === b.is_pinned) return 0;
        return a.is_pinned ? -1 : 1;
    });
  }, [chats, searchQuery]);

  const selectChat = (chatId: string) => {
    if (onSelectChat) onSelectChat(chatId);
  };

  const handleModalSelect = (chatId: string) => {
    selectChat(chatId);
    setIsSearchModalOpen(false);
    setSearchQuery('');
  };

  const handlePinChat = async (chatId: string, currentPinStatus: boolean) => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_URL}/api/chats/${chatId}/pin`, {
        method: 'PATCH',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ is_pinned: !currentPinStatus })
      });

      if (response.ok) {
        setChats(prev => prev.map(chat => 
          chat.id === chatId ? { ...chat, is_pinned: !currentPinStatus } : chat
        ));
      }
    } catch (error) {
      console.error('Failed to pin chat:', error);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_URL}/api/chats/${chatId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        setChats(prev => prev.filter(chat => chat.id !== chatId));
        if (activeSessionId === chatId) {
          if (onSelectChat) onSelectChat('');
        }
      }
    } catch (error) {
      console.error('Failed to delete chat:', error);
    }
  };

  // Desktop right-click still opens the same menu, anchored to cursor
  const handleContextMenu = (e: React.MouseEvent, chat: ChatSession) => {
    e.preventDefault();
    setActionMenu({
      chatId: chat.id,
      isPinned: !!chat.is_pinned,
      anchor: { x: e.clientX, y: e.clientY }
    });
  };

  // --- Long-press handlers (mobile) ---
  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const startPressTimer = (chat: ChatSession) => {
    longPressFiredRef.current = false;
    clearPressTimer();
    pressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      // Mobile long-press opens as a bottom sheet (no anchor coordinates needed)
      setActionMenu({ chatId: chat.id, isPinned: !!chat.is_pinned, anchor: null });
      if (navigator.vibrate) navigator.vibrate(10);
    }, LONG_PRESS_MS);
  };

  const handleChatClick = (chatId: string) => {
    // Swallow the click that follows a long-press so it doesn't also open the chat
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    selectChat(chatId);
  };

  return (
    <>
      {/* Backdrop: only rendered on mobile when sidebar is open, sits behind the sliding panel */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        className={cn(
          "bg-background border-r shrink-0 flex flex-col z-40",
          // Mobile: full-screen sliding overlay, fixed to viewport, off-canvas when closed
          "fixed inset-y-0 left-0 w-full transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop (md+): back to a normal in-flow column, never off-canvas, width animates instead
          "md:static md:translate-x-0 md:transition-[width] md:h-full",
          isOpen ? "md:w-64" : "md:w-[72px]"
        )}
        style={{ height: '100dvh' }}
      >
        <div className="flex flex-col h-full overflow-hidden w-full">
          <div className="flex flex-col flex-1 p-4 overflow-hidden">
            
            {isOpen ? (
              <>
                {/* Mobile-only top bar: title + explicit close button so it's never hidden */}
                <div className="flex items-center justify-between mb-4 shrink-0 md:hidden">
                  <button
                    onClick={() => setIsAboutModalOpen(true)}
                    className="flex items-center gap-3 px-1 hover:opacity-80 transition-opacity text-left outline-none min-w-0"
                  >
                    <img src={logo} alt="BU Logo" className="w-7 h-7 object-contain rounded-md shrink-0" />
                    <span className="text-[16px] font-medium truncate">BU Chatbot</span>
                  </button>
                  <button
                    onClick={onClose}
                    className="p-2.5 -mr-1 hover:bg-accent rounded-full text-muted-foreground transition-colors shrink-0"
                    aria-label="Close sidebar"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Desktop title (no close button needed; toggled from the header) */}
                <button 
                  onClick={() => setIsAboutModalOpen(true)}
                  className="hidden md:flex items-center mb-6 shrink-0 gap-3 px-1 mt-1 hover:opacity-80 transition-opacity text-left outline-none"
                >
                  <img src={logo} alt="BU Logo" className="w-7 h-7 object-contain rounded-md" />
                  <span className="text-[16px] font-medium truncate">BU Chatbot</span>
                </button>

                <div className="relative mb-4 shrink-0">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search chats..."
                    className="pl-8 h-11 md:h-9 text-base md:text-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <ScrollArea className="flex-1 -mx-4 px-4">
                  <div className="space-y-1 md:space-y-2 pb-4">
                    {filteredChats.length === 0 ? (
                      <p className="text-sm text-center text-muted-foreground mt-4">
                        No chats found
                      </p>
                    ) : (
                      filteredChats.map((chat) => {
                        const isActive = activeSessionId === chat.id;

                        return (
                          <div 
                            key={chat.id} 
                            className="group relative"
                            onContextMenu={(e) => handleContextMenu(e, chat)}
                            onPointerDown={(e) => {
                              // Only treat touch/pen as long-press source; mouse uses right-click above
                              if (e.pointerType === 'mouse') return;
                              startPressTimer(chat);
                            }}
                            onPointerUp={clearPressTimer}
                            onPointerLeave={clearPressTimer}
                            onPointerCancel={clearPressTimer}
                          >
                            <Button
                              variant={isActive ? "secondary" : "ghost"}
                              className="w-full justify-start gap-2 pr-4 overflow-hidden h-12 md:h-9" 
                              onClick={() => handleChatClick(chat.id)}
                            >
                              <MessageCircle className={cn("h-4 w-4 shrink-0", chat.is_pinned && "text-blue-500")} />
                              <span className="flex-1 truncate text-left">{chat.title}</span>
                              {chat.is_pinned && (
                                <Pin className="h-3.5 w-3.5 shrink-0 text-blue-500 md:hidden" />
                              )}
                            </Button>
                            
                            {/* Desktop-only hover actions. Mobile uses long-press instead. */}
                            <div className={cn(
                              "absolute right-1 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-1 bg-background/90 px-1 rounded-md",
                              "opacity-0 group-hover:opacity-100 transition-opacity",
                              isActive && "opacity-100"
                            )}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePinChat(chat.id, !!chat.is_pinned);
                                }}
                                aria-label="Pin chat"
                              >
                                {chat.is_pinned ? <PinOff className="h-4 w-4 text-muted-foreground" /> : <Pin className="h-4 w-4 text-muted-foreground" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteChat(chat.id);
                                }}
                                aria-label="Delete chat"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex flex-col items-center gap-6 mt-1 shrink-0">
                <button 
                  onClick={() => setIsAboutModalOpen(true)}
                  className="hover:opacity-80 transition-opacity outline-none"
                  aria-label="About BU Chatbot"
                >
                  <img src={logo} alt="BU Logo" className="w-7 h-7 object-contain rounded-md" />
                </button>
                
                <button 
                  className="p-2 hover:bg-accent rounded-full text-muted-foreground transition-colors" 
                  aria-label="Search"
                  onClick={() => setIsSearchModalOpen(true)}
                >
                  <Search className="w-5 h-5" />
                </button>
              </div>
            )}

          </div>

          <div className={cn(
            "p-4 border-t flex bg-background shrink-0 transition-all", 
            isOpen ? "flex-row items-center justify-between" : "flex-col items-center gap-4 pb-6"
          )}>
            {!isOpen && <ThemeToggle />}
            
            <UserButton 
              afterSignOutUrl="/" 
              appearance={{
                elements: {
                  userButtonBox: isOpen ? "flex-row-reverse" : "justify-center",
                  userButtonOuterIdentifier: isOpen ? "text-foreground font-medium" : "hidden",
                }
              }}
              showName={isOpen}
            />

            {isOpen && <ThemeToggle />}
          </div>
        </div>
      </div>

      {/* Desktop floating context menu (right-click) */}
      {actionMenu && actionMenu.anchor && (
        <div
          className="fixed z-[100] min-w-[160px] bg-popover text-popover-foreground border shadow-md rounded-md p-1 animate-in fade-in zoom-in-95 hidden md:block"
          style={{ top: actionMenu.anchor.y, left: actionMenu.anchor.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground outline-none transition-colors"
            onClick={() => {
              handlePinChat(actionMenu.chatId, actionMenu.isPinned);
              setActionMenu(null);
            }}
          >
            {actionMenu.isPinned ? <PinOff className="w-4 h-4 text-muted-foreground" /> : <Pin className="w-4 h-4 text-muted-foreground" />}
            {actionMenu.isPinned ? 'Unpin' : 'Pin'}
          </button>
          
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm hover:bg-destructive/90 hover:text-destructive-foreground text-destructive outline-none transition-colors mt-0.5"
            onClick={() => {
              handleDeleteChat(actionMenu.chatId);
              setActionMenu(null);
            }}
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      )}

      {/* Mobile bottom-sheet action menu (long-press) */}
      {actionMenu && !actionMenu.anchor && (
        <div className="fixed inset-0 z-[100] md:hidden" onClick={() => setActionMenu(null)}>
          <div className="absolute inset-0 bg-black/50 animate-in fade-in duration-150" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-background border-t rounded-t-2xl p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-muted rounded-full mx-auto my-2" />
            <button
              className="w-full flex items-center gap-3 px-4 py-3.5 text-base rounded-lg hover:bg-accent outline-none transition-colors"
              onClick={() => {
                handlePinChat(actionMenu.chatId, actionMenu.isPinned);
                setActionMenu(null);
              }}
            >
              {actionMenu.isPinned ? <PinOff className="w-5 h-5 text-muted-foreground" /> : <Pin className="w-5 h-5 text-muted-foreground" />}
              {actionMenu.isPinned ? 'Unpin chat' : 'Pin chat'}
            </button>
            <button
              className="w-full flex items-center gap-3 px-4 py-3.5 text-base rounded-lg hover:bg-accent text-destructive outline-none transition-colors"
              onClick={() => {
                handleDeleteChat(actionMenu.chatId);
                setActionMenu(null);
              }}
            >
              <Trash2 className="w-5 h-5" />
              Delete chat
            </button>
          </div>
        </div>
      )}

      {/* Search Modal */}
      {isSearchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center md:pt-[15vh] bg-background/80 backdrop-blur-sm md:p-4">
          <div 
            className="w-full md:max-w-lg bg-background border-0 md:border rounded-none md:rounded-xl shadow-lg flex flex-col overflow-hidden h-[100dvh] md:h-auto md:max-h-[70vh] animate-in fade-in zoom-in-95 duration-200"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            
            <div className="flex items-center p-3 border-b shrink-0">
              <Search className="w-5 h-5 text-muted-foreground ml-2 mr-3 shrink-0" />
              <Input
                autoFocus
                placeholder="Search chats..."
                className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 shadow-none text-base"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button 
                onClick={() => setIsSearchModalOpen(false)} 
                className="p-2.5 rounded-md hover:bg-accent ml-2 text-muted-foreground transition-colors shrink-0"
                aria-label="Close search"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <ScrollArea className="flex-1 p-2 min-h-0">
              <div className="space-y-1">
                {filteredChats.length === 0 ? (
                  <p className="text-sm text-center text-muted-foreground py-8">
                    No chats found for "{searchQuery}"
                  </p>
                ) : (
                  filteredChats.map((chat) => (
                    <Button
                      key={chat.id}
                      variant="ghost"
                      className="w-full justify-start gap-3 truncate h-12"
                      onClick={() => handleModalSelect(chat.id)}
                    >
                      <MessageCircle className={cn("h-4 w-4 shrink-0", chat.is_pinned ? "text-blue-500" : "text-muted-foreground")} />
                      <span className="truncate font-normal">{chat.title}</span>
                    </Button>
                  ))
                )}
              </div>
            </ScrollArea>
            
          </div>
        </div>
      )}

      {/* About Modal */}
      {isAboutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center md:pt-[15vh] bg-background/80 backdrop-blur-sm md:p-4">
          <div 
            className="w-full md:max-w-lg bg-background border-0 md:border rounded-none md:rounded-xl shadow-lg flex flex-col overflow-hidden h-[100dvh] md:h-auto md:max-h-[70vh] animate-in fade-in zoom-in-95 duration-200"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            
            <div className="flex items-center justify-between p-4 border-b shrink-0">
              <h2 className="text-lg font-semibold">About BU Chatbot</h2>
              <button 
                onClick={() => setIsAboutModalOpen(false)} 
                className="p-2.5 rounded-md hover:bg-accent text-muted-foreground transition-colors shrink-0"
                aria-label="Close about modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-4 text-sm text-muted-foreground p-6">
                <p>
                  This chatbot is an unofficial, student-built assistant designed to help students quickly find answers to common academic and administrative questions. It uses publicly available university documents, including the official student rulebook, to retrieve relevant information and present it in a clear, conversational way.
                </p>
                <p>
                  The chatbot does not represent the university, does not replace official announcements, and may occasionally be incomplete or outdated. Its purpose is to save time, reduce confusion, and help students navigate rules, policies, and procedures more efficiently. For final or critical decisions, students should always verify information through official university channels.
                </p>
                
                <div className="my-6 border-t border-border"></div>
                
                <div className="space-y-4">
                  <p className="font-medium text-foreground">Project Developed by Muneeb Ur Rehman Siddiqui</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-2">
                    <a href="https://www.linkedin.com/in/muneeb-ur-rehman-siddiqui-618a6336a/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-foreground transition-colors py-1">
                      <Linkedin className="w-4 h-4" />
                      Developer Info
                    </a>
                    <a href="https://www.bahria.edu.pk/content/Downloads/7ee35795-119a-4591-8c44-f93da14e5044.pdf" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-foreground transition-colors py-1">
                      <FileText className="w-4 h-4" />
                      Source Document
                    </a>
                    <a href="https://www.kaggle.com/datasets/muneeburrehman98/bu-student-rulebook-spring-2025-structured-json" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-foreground transition-colors py-1">
                      <Database className="w-4 h-4" />
                      Source Dataset
                    </a>
                    <a href="https://github.com/BeUnMerreHuman/BU-Chatbot" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-foreground transition-colors py-1">
                      <Github className="w-4 h-4" />
                      Source Code
                    </a>
                  </div>
                </div>
              </div>
            </ScrollArea>
            
          </div>
        </div>
      )}
    </>
  );
}