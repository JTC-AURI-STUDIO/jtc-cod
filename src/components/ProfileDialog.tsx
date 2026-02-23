import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { User, Key, Lock, Save, Loader2, Upload, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

const ProfileDialog = ({ open, onOpenChange, userId }: ProfileDialogProps) => {
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [aiProvider, setAiProvider] = useState("gemini");
  const [aiApiKey, setAiApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) loadProfile();
  }, [open]);

  const loadProfile = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (data) {
      setDisplayName(data.display_name || "");
      setAvatarUrl(data.avatar_url || "");
      setAiProvider(data.ai_provider || "gemini");
      setAiApiKey(data.ai_api_key || "");
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Erro", description: "Selecione uma imagem.", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${userId}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(path);

      setAvatarUrl(`${urlData.publicUrl}?t=${Date.now()}`);
      toast({ title: "Foto atualizada!" });
    } catch (err: any) {
      toast({ title: "Erro no upload", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: displayName.trim(),
          avatar_url: avatarUrl,
          ai_provider: aiProvider,
          ai_api_key: aiApiKey.trim(),
        })
        .eq("user_id", userId);

      if (error) throw error;
      toast({ title: "Perfil salvo!" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      toast({ title: "Erro", description: "A senha deve ter pelo menos 6 caracteres.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Erro", description: "As senhas não coincidem.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Senha alterada!" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const initials = displayName ? displayName.slice(0, 2).toUpperCase() : "US";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono">
            <User className="h-5 w-5 text-primary" />
            Meu Perfil
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <Avatar className="h-20 w-20">
              <AvatarImage src={avatarUrl} />
              <AvatarFallback className="bg-primary/20 text-primary font-mono text-lg">
                {initials}
              </AvatarFallback>
            </Avatar>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="font-mono text-xs"
            >
              {uploading ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Upload className="h-3 w-3 mr-1" />
              )}
              Alterar foto
            </Button>
          </div>

          {/* Display Name */}
          <div>
            <label className="text-sm font-mono text-muted-foreground mb-1 block">Nome</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Seu nome"
              className="bg-muted border-border font-mono text-sm"
            />
          </div>

          {/* API Key Section */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1">
              <Key className="h-3 w-3" /> Chave API de IA
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-mono text-muted-foreground mb-1 block">Provedor</label>
                <Select value={aiProvider} onValueChange={setAiProvider}>
                  <SelectTrigger className="bg-muted border-border font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Google Gemini</SelectItem>
                    <SelectItem value="openai">OpenAI (ChatGPT)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-mono text-muted-foreground mb-1 block">API Key</label>
                <div className="relative">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder={aiProvider === "gemini" ? "AIzaSy..." : "sk-..."}
                    className="bg-muted border-border font-mono text-sm pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {aiProvider === "gemini"
                    ? "Obtenha em aistudio.google.com"
                    : "Obtenha em platform.openai.com"}
                </p>
              </div>
            </div>
          </div>

          <Button
            onClick={handleSaveProfile}
            disabled={loading}
            className="w-full font-mono"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Salvar Perfil
          </Button>

          {/* Change Password */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1">
              <Lock className="h-3 w-3" /> Alterar Senha
            </p>
            <div className="space-y-3">
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nova senha"
                className="bg-muted border-border font-mono text-sm"
              />
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirmar senha"
                className="bg-muted border-border font-mono text-sm"
              />
              <Button
                variant="outline"
                onClick={handleChangePassword}
                disabled={loading || !newPassword}
                className="w-full font-mono text-sm"
              >
                <Lock className="h-4 w-4 mr-2" />
                Alterar Senha
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProfileDialog;
