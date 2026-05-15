# JARVIS · OS Brasil v4.0 — Vercel Deploy

Interface com microfone, voz e IA real (Claude Sonnet 4).
A chave da API fica segura no servidor — nunca exposta no browser.

---

## Deploy em 5 passos

### 1. Conta no GitHub
Acesse https://github.com e crie uma conta gratuita (se não tiver).

### 2. Criar repositório e subir os arquivos
- No GitHub: New repository → nome: jarvis-os (pode ser privado)
- Clique em "uploading an existing file"
- Arraste TODOS os arquivos deste ZIP
- Commit changes

### 3. Conta no Vercel
Acesse https://vercel.com → entrar com GitHub.

### 4. Importar o projeto
- Add New → Project → selecione jarvis-os → Deploy
- (vai dar erro na primeira vez, normal — falta a chave)

### 5. Adicionar a chave da API
- Vercel → Settings → Environment Variables
- Name: ANTHROPIC_API_KEY
- Value: sk-ant-api03-SUA_CHAVE
- Marque: Production + Preview + Development → Save
- Deployments → 3 pontinhos → Redeploy

Seu JARVIS estará em: https://jarvis-os-USUARIO.vercel.app

---

## Chave da API
https://console.anthropic.com → API Keys → Create Key

---

## Microfone
Funciona direto no Vercel. O browser pede permissão na primeira vez.

## Segurança
A chave fica no servidor Vercel. O browser nunca a vê.
