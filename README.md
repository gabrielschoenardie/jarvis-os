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

---

## Cérebro Obsidian (modo VAULT)

O modo `VAULT` (botão no topo, ou comando `/vault`) substitui a projeção do reator arc por um grafo 3D do seu vault Obsidian real — cada nota vira um ponto de luz, cada `[[wikilink]]` vira uma conexão.

- **Requisito**: navegador Chromium (Chrome ou Edge) — usa a File System Access API, que não existe no Firefox/Safari.
- **Conectar**: clique em `▸ CONECTAR VAULT` e escolha a pasta do seu vault. As notas são lidas **inteiramente no navegador** — nenhum conteúdo sobe a servidor, exceto quando você clica em `▸ ANALISAR COM JARVIS` numa nota específica (aí só o texto daquela nota é enviado à IA).
- **Reconectar**: ao reabrir o navegador, um clique em `▸ RECONECTAR VAULT` restaura o acesso, sem escolher a pasta de novo.
- **Analisar uma nota**: clique num ponto do grafo → painel com preview abre → `▸ ANALISAR COM JARVIS` envia o conteúdo pra IA responder em voz e texto.
