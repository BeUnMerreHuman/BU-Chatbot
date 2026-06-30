import { Menu, PlusCircle } from "lucide-react"; 
import { Button } from "@/components/ui/button";

interface HeaderProps {
  toggleSidebar: () => void;
  onNewChat?: () => void; // Passed from parent to handle new chat action
}

export const Header = ({ toggleSidebar, onNewChat }: HeaderProps) => { 
  return (
    <header className="flex items-center justify-between px-4 md:px-6 h-[60px] border-b border-border bg-background/80 backdrop-blur-md text-foreground w-full shrink-0">
      
      {/* Left: Sidebar Toggle Button */}
      <div className="flex-1 flex items-center">
        <button 
          onClick={toggleSidebar}
          className="p-2 -ml-2 mr-2 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground bg-transparent"
          aria-label="Toggle Sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div> 

      {/* Right side: New Chat Button */}
      <div className="flex flex-1 items-center justify-end space-x-2">
        <Button 
          onClick={onNewChat} 
          variant="outline" 
          size="sm" 
          className="gap-2 rounded-full"
        >
          <PlusCircle className="h-4 w-4" />
          New Chat
        </Button>
      </div>

    </header>
  );
};