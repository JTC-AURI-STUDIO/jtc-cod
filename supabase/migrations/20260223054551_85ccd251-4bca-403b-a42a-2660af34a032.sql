
-- Create repositories table
CREATE TABLE IF NOT EXISTS public.repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  repo_url TEXT NOT NULL,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  github_token TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.repositories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own repos"
  ON public.repositories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own repos"
  ON public.repositories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own repos"
  ON public.repositories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own repos"
  ON public.repositories FOR DELETE USING (auth.uid() = user_id);

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  repository_id UUID NOT NULL REFERENCES public.repositories(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  files_changed TEXT[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own messages"
  ON public.chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own messages"
  ON public.chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create agent_commits table
CREATE TABLE IF NOT EXISTS public.agent_commits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  repository_id UUID NOT NULL REFERENCES public.repositories(id) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL,
  commit_message TEXT NOT NULL,
  files_changed TEXT[],
  can_undo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_commits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own commits"
  ON public.agent_commits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own commits"
  ON public.agent_commits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own commits"
  ON public.agent_commits FOR UPDATE USING (auth.uid() = user_id);
