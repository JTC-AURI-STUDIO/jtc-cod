import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getDefaultBranch(owner: string, name: string, token: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error("Não consegui acessar o repositório. Verifique se o token é válido.");
  const data = await res.json();
  return data.default_branch || "main";
}

async function getRepoTree(owner: string, name: string, branch: string, token: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Não consegui ler a árvore do repositório na branch ${branch}`);
  return res.json();
}

async function getFileContent(owner: string, name: string, path: string, token: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.encoding === "base64") {
    try {
      const raw = atob(data.content.replace(/\n/g, ""));
      return { content: decodeURIComponent(escape(raw)), sha: data.sha, path: data.path };
    } catch {
      return { content: atob(data.content.replace(/\n/g, "")), sha: data.sha, path: data.path };
    }
  }
  return null;
}

async function commitFile(
  owner: string, name: string, path: string, content: string,
  sha: string | null, message: string, branch: string, token: string
) {
  const body: any = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`GitHub API error for ${path} [${res.status}]: ${errText}`);
    throw new Error(`Falha ao salvar ${path} no GitHub (status ${res.status})`);
  }
  return res.json();
}

function detectProjectType(files: string[]): string {
  const hasPackageJson = files.includes("package.json");
  const hasViteConfig = files.some(f => f.includes("vite.config"));
  const hasSrcFolder = files.some(f => f.startsWith("src/"));
  const hasNextConfig = files.some(f => f.includes("next.config"));
  
  if (hasNextConfig) return "nextjs";
  if (hasViteConfig && hasSrcFolder) return "vite-react";
  if (hasPackageJson && hasSrcFolder) return "react";
  if (files.includes("index.html")) return "static-html";
  return "generic";
}

// Build the AI API URL and headers based on user's provider
function getAiConfig(provider: string, apiKey: string) {
  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      intentModel: "gpt-4o-mini",
      chatModel: "gpt-4o-mini",
      codeModel: "gpt-4o",
      selectionModel: "gpt-4o-mini",
    };
  }
  // Default: Gemini
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    intentModel: "gemini-2.0-flash-lite",
    chatModel: "gemini-2.0-flash",
    codeModel: "gemini-2.5-flash",
    selectionModel: "gemini-2.0-flash",
  };
}

async function callAi(config: ReturnType<typeof getAiConfig>, model: string, messages: any[], temperature = 0.1, maxTokens?: number) {
  const body: any = { model, messages, temperature };
  if (maxTokens) body.max_tokens = maxTokens;

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(config.url, {
      method: "POST",
      headers: config.headers,
      body: JSON.stringify(body),
    });

    if (res.ok) return res.json();

    if (res.status === 429) {
      if (attempt < maxRetries - 1) {
        const wait = Math.pow(2, attempt + 1) * 1000;
        console.log(`Rate limited (429), retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      // Fallback to Lovable AI Gateway
      console.log("User API key rate limited after retries, falling back to Lovable AI Gateway");
      return callLovableAi(messages, temperature, maxTokens);
    }
    if (res.status === 401 || res.status === 403) {
      await res.text();
      throw { status: 401, message: "Chave API inválida. Verifique nas configurações do perfil." };
    }
    const t = await res.text();
    console.error("AI error:", res.status, t);
    throw { status: 500, message: "Erro na IA" };
  }
  throw { status: 500, message: "Erro inesperado na IA" };
}

async function callLovableAi(messages: any[], temperature = 0.1, maxTokens?: number) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw { status: 500, message: "Fallback AI não configurado" };

  const body: any = {
    model: "google/gemini-3-flash-preview",
    messages,
    temperature,
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("Lovable AI fallback error:", res.status, t);
    if (res.status === 429) throw { status: 429, message: "Limite de requisições atingido. Tente novamente em alguns segundos." };
    if (res.status === 402) throw { status: 402, message: "Créditos de IA esgotados." };
    throw { status: 500, message: "Erro no fallback de IA" };
  }
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, repo_owner, repo_name, github_token, history, user_id } = await req.json();

    // Fetch user's AI config from profiles
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const { data: profile } = await sb
      .from("profiles")
      .select("ai_provider, ai_api_key")
      .eq("user_id", user_id)
      .maybeSingle();

    if (!profile?.ai_api_key) {
      return new Response(JSON.stringify({
        error: "Configure sua chave API de IA no perfil antes de usar o agente."
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiConfig = getAiConfig(profile.ai_provider || "gemini", profile.ai_api_key);

    // Step 1: Determine intent
    const intentData = await callAi(aiConfig, aiConfig.intentModel, [
      {
        role: "system",
        content: `Analyze the user message and determine if they want to modify code in a GitHub repository, or if they just want to chat/ask a question.
Return ONLY "code" if they want code changes, or "chat" if they just want to talk.
Examples of "code": "muda a cor para azul", "adiciona um footer", "refatora o componente", "cria um novo arquivo", "remove esse texto", "troca o nome"
Examples of "chat": "o que você acha de React?", "me explica como funciona CSS", "oi tudo bem?", "quero criar um novo repositório", "como eu faço deploy?"`,
      },
      { role: "user", content: message },
    ], 0, 10);

    const intent = (intentData.choices?.[0]?.message?.content || "").trim().toLowerCase();

    // CHAT MODE
    if (intent !== "code") {
      const chatData = await callAi(aiConfig, aiConfig.chatModel, [
        {
          role: "system",
          content: `Você é o JTC COD, um assistente inteligente de programação. Você conversa de forma natural, amigável e direta em português brasileiro.

Você está conectado ao repositório GitHub: ${repo_owner}/${repo_name}

Você pode:
- Conversar sobre qualquer assunto
- Tirar dúvidas sobre programação
- Dar sugestões sobre o projeto
- Explicar conceitos técnicos
- Ajudar a planejar features

Quando o usuário quiser que você modifique o código, ele vai pedir diretamente. Aí sim você age.

Seja natural, como um amigo programador. Não seja robótico. Use emojis quando fizer sentido. NUNCA inclua blocos de código na resposta.`,
        },
        ...(history || []),
        { role: "user", content: message },
      ], 0.7);

      const chatResponse = chatData.choices?.[0]?.message?.content || "Desculpa, não entendi. Pode repetir?";

      return new Response(JSON.stringify({
        response: chatResponse,
        files_changed: [],
        commit_sha: null,
        commit_message: null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // CODE MODE
    console.log(`[CODE MODE] User wants code changes: "${message}"`);

    const branch = await getDefaultBranch(repo_owner, repo_name, github_token);
    const tree = await getRepoTree(repo_owner, repo_name, branch, github_token);
    const allFiles = tree.tree?.filter((f: any) => f.type === "blob")?.map((f: any) => f.path) || [];

    console.log(`[CODE MODE] Found ${allFiles.length} files in ${branch}`);

    const projectType = detectProjectType(allFiles);
    const criticalFiles = ["package.json", "index.html", "tsconfig.json", "vite.config.ts", "vite.config.js", "tailwind.config.ts", "tailwind.config.js"];

    // Step 2: Ask AI which files to load
    const selData = await callAi(aiConfig, aiConfig.selectionModel, [{
      role: "user",
      content: `Repository files:\n${allFiles.join("\n")}\n\nUser request: "${message}"\n\nReturn a JSON array of file paths that are relevant to this request. Max 15 files. Include files that import/reference the target files too so you understand the context. Only return the JSON array, nothing else.\nExample: ["src/App.css", "src/index.html"]`,
    }], 0.1);

    let selectedFiles: string[] = [];
    let raw = selData.choices?.[0]?.message?.content || "[]";
    raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    try { selectedFiles = JSON.parse(raw); } catch { /* fallback below */ }

    if (selectedFiles.length === 0) {
      const codeExts = [".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".json", ".py", ".vue", ".svelte", ".scss"];
      selectedFiles = allFiles.filter((f: string) => codeExts.some((ext: string) => f.endsWith(ext))).slice(0, 12);
    }

    selectedFiles = selectedFiles.filter((f: string) => allFiles.includes(f));
    console.log(`[CODE MODE] Selected files: ${selectedFiles.join(", ")}`);

    // Step 3: Load file contents
    const fileContents: { path: string; content: string; sha: string }[] = [];
    await Promise.all(selectedFiles.map(async (fp: string) => {
      const file = await getFileContent(repo_owner, repo_name, fp, github_token);
      if (file && file.content.length < 20000) fileContents.push(file);
    }));

    const fileContext = fileContents.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n");

    // Step 4: Ask AI to generate changes
    const codeData = await callAi(aiConfig, aiConfig.codeModel, [
      {
        role: "system",
        content: `Você é o JTC COD, agente de edição de código. Você modifica código em repositórios GitHub.

REPOSITÓRIO: ${repo_owner}/${repo_name} (branch: ${branch})
TIPO DE PROJETO: ${projectType}

TODOS OS ARQUIVOS DO REPO:
${allFiles.join("\n")}

CONTEÚDO DOS ARQUIVOS CARREGADOS:
${fileContext}

Retorne APENAS um JSON válido com esta estrutura:
{
  "explanation": "frase curta e natural em português explicando o que você fez, SEM incluir código",
  "changes": [
    {
      "path": "caminho/arquivo.ext",
      "action": "update",
      "content": "CONTEÚDO COMPLETO DO ARQUIVO INTEIRO COM AS MUDANÇAS"
    }
  ],
  "commit_message": "mensagem curta em inglês tipo: fix: change primary color"
}

REGRAS CRÍTICAS:
1. O campo "content" DEVE conter o arquivo COMPLETO INTEIRO, não só a parte modificada
2. Faça SOMENTE o que o usuário pediu, nada a mais nada a menos
3. A "explanation" deve ser natural e curta, sem blocos de código, sem markdown de código
4. Se precisar criar arquivo novo, use action "create"
5. NUNCA retorne nada além do JSON
6. NUNCA delete ou modifique estes arquivos críticos: ${criticalFiles.join(", ")}
7. Mantenha TODAS as importações e exports existentes intactos
8. Se um arquivo importa de outro, certifique-se que os imports continuam válidos
9. Preserve a estrutura do projeto - não quebre o build
10. Se não souber exatamente o que mudar, pergunte em vez de chutar
11. VERIFIQUE TODO O CÓDIGO - garanta que está 100% funcional antes de enviar
12. Teste mentalmente cada mudança - imports, variáveis, funções devem estar corretos`,
      },
      ...(history || []),
      { role: "user", content: message },
    ], 0.15);

    let rawContent = codeData.choices?.[0]?.message?.content || "";
    rawContent = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      console.error(`[CODE MODE] Failed to parse AI response: ${rawContent.substring(0, 500)}`);
      return new Response(JSON.stringify({
        response: "Desculpa, tive um problema ao processar. Tenta de novo com mais detalhes? 😅",
        files_changed: [], commit_sha: null, commit_message: null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!parsed.changes || parsed.changes.length === 0) {
      return new Response(JSON.stringify({
        response: parsed.explanation || "Não identifiquei nenhuma mudança necessária. Pode detalhar melhor o que quer?",
        files_changed: [], commit_sha: null, commit_message: null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Safety check
    for (const change of parsed.changes) {
      if (criticalFiles.includes(change.path) && (!change.content || change.content.trim().length < 10)) {
        return new Response(JSON.stringify({
          response: `⚠️ Não posso modificar ${change.path} dessa forma - é um arquivo crítico do projeto. Me diz exatamente o que quer mudar nele?`,
          files_changed: [], commit_sha: null, commit_message: null,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Step 5: Apply changes
    let lastCommitSha: string | null = null;
    const filesChanged: string[] = [];
    const errors: string[] = [];

    for (const change of parsed.changes) {
      if (!change.path || !change.content) continue;
      try {
        const freshFile = await getFileContent(repo_owner, repo_name, change.path, github_token);
        const sha = freshFile?.sha || null;
        const result = await commitFile(
          repo_owner, repo_name, change.path, change.content,
          sha, parsed.commit_message || "update via JTC COD", branch, github_token
        );
        lastCommitSha = result.commit?.sha || null;
        filesChanged.push(change.path);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[CODE MODE] ❌ Failed to commit ${change.path}: ${errMsg}`);
        errors.push(`${change.path}: ${errMsg}`);
      }
    }

    let response = "";
    if (filesChanged.length > 0) {
      response = parsed.explanation || "Pronto, modificações aplicadas!";
      response += `\n\n✅ Arquivos atualizados: ${filesChanged.join(", ")}`;
      if (lastCommitSha) response += `\n🔗 Commit: \`${lastCommitSha.slice(0, 7)}\``;
    }
    if (errors.length > 0) {
      if (filesChanged.length === 0) {
        response = `❌ Não consegui fazer as modificações.\n\n${errors.map(e => `• ${e}`).join("\n")}\n\nVerifica se o token tem a permissão "repo" habilitada.`;
      } else {
        response += `\n\n⚠️ Alguns arquivos falharam:\n${errors.map(e => `• ${e}`).join("\n")}`;
      }
    }
    if (!response) response = "Algo deu errado, não consegui processar. Tenta de novo?";

    return new Response(JSON.stringify({
      response, files_changed: filesChanged,
      commit_sha: lastCommitSha, commit_message: parsed.commit_message,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("code-agent error:", e);
    const status = e?.status || 500;
    const msg = e?.message || (e instanceof Error ? e.message : "Erro desconhecido");
    return new Response(JSON.stringify({ error: `Erro: ${msg}` }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
