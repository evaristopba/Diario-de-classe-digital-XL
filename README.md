# 📚 Diário de Classe Digital - Gestão Pedagógica e Escolar Completa

Sistema completo para professores, bibliotecários e administradores escolares gerenciarem **Chamadas, Notas Bimestrais, Planos de Aula (BNCC), Biblioteca Escolar (Livros e Empréstimos), Ocorrências Disciplinares, Relatórios (PDF/Excel), Grade Curricular e Rotina de Backup/Restauração**.

---

## ✨ Principais Funcionalidades

- **Controle de Chamadas (Frequência)**: Registro diário rápido com presença, falta, falta justificada, histórico de aulas e cálculo automático de percentual de frequência.
- **Notas e Avaliações Bimestrais**: Lançamento por bimestres/trimestres, cálculo de médias, recuperação, notas finais e status de aprovação.
- **Planos de Aula & BNCC**: Criação e acompanhamento de planos de aula integrados com habilidades da Base Nacional Comum Curricular (BNCC).
- **Biblioteca Escolar & Cantinho da Leitura (Acervo Integrado & Descentralizado)**:
  - **Documentação Detalhada**: Consulte o guia completo em [`MANUAL_BIBLIOTECA.md`](./MANUAL_BIBLIOTECA.md).
  - **Cadastro Rápido com Leitura Visual (IA Gemini Vision)**: fotografe a capa frontal e a contracapa da obra e a IA extrai automaticamente título, autor(a), ilustrador, editora, ano, gênero, sinopse e código ISBN, com limpeza automática de dados residuais entre leituras. O ISBN é validado pelo dígito verificador, cruzado com o código de barras lido no aparelho e conferido na CBL/Google Books; qualquer dúvida aparece como aviso na tela.
  - **Busca Instantânea por ISBN**: integração com APIs do Google Books e OpenLibrary para autopreenchimento imediato de todos os dados e carregamento da capa oficial.
  - **Gestão de Acervo Multi-Escola & Distribuição**: suporte a cadastros unificados no modelo Obra Mestra vs. Exemplares Físicos Locais (`copiesBySchool`), distribuição simultânea de remessas para múltiplas escolas no momento do cadastro e detecção inteligente em tempo real de obras pré-existentes para evitar duplicações.
  - **Circulação & Empréstimos**: empréstimo direto para alunos por turma, controle automático de prazos de devolução, detecção de atrasos em tempo real, renovação rápida com 1 clique (+7 dias) e identificação visual do destino físico do exemplar no momento da devolução.
  - **Cantinho da Leitura em Sala de Aula**: extensão pedagógica na sala com segregação patrimonial atômica (sem debitar a biblioteca central durante os empréstimos aos alunos da turma), etiquetas visuais de procedência (`🏫 Cantinho da Sala` vs `📚 Biblioteca Central`) e recolhimento seguro de volta ao acervo central ao final do ciclo letivo.
  - **Remanejamento de Obras**: transferência documentada de exemplares entre bibliotecas de diferentes escolas da rede com histórico e motivo.
  - **Histórico & Auditoria**: rastreabilidade completa de leituras concluídas e movimentações físicas entre unidades.
  - **Exportações Gerenciais**: inventários e relatórios em Excel (.xlsx) e comprovantes de empréstimo formatados para impressão em PDF.
- **Ocorrências e Eventos**: Registro pedagógico e comportamental com tipificação personalizável e histórico por estudante.
- **Gestão de Escolas, Turmas e Professores**: Controle de acesso segregado entre Administrador, Professor e Bibliotecário, com integridade referencial.
- **Relatórios Gerenciais**: Exportação para PDF formatado para impressão e planilhas Excel (.xlsx) de notas, presenças, planos e fichas de alunos.
- **Rotina de Backup & Restauração Completa**:
  - Exportação e importação de backups integrais em arquivo JSON.
  - Restauração granular seletiva (Escolas, Turmas, Disciplinas, BNCC, Chamadas, Notas, Planos, Ocorrências e Biblioteca).
  - Verificação de integridade e metadados com contadores em tempo real.
- **Disponibilidade Offline e Pacote Autônomo**: Suporte a arquivo único HTML (`app-unico.html`) para uso direto no navegador sem necessidade de servidor Node.js.

---

## 🚀 Como Subir para o GitHub e Fazer Deploy na Vercel

### Opção 1: Projeto Completo (React + Vite + Tailwind) - Recomendado

#### Passo 1: Criar o Repositório no GitHub
1. Acesse [github.com](https://github.com) e crie um novo repositório (ex: `diario-de-classe`).
2. No seu computador, descompacte o arquivo `diario-de-classe-projeto.zip`.
3. Abra o terminal na pasta do projeto e execute:
```bash
git init
git add .
git commit -m "feat: publicacao do diario de classe digital"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git push -u origin main
```

#### Passo 2: Publicar na Vercel (1 Clique)
1. Acesse [vercel.com](https://vercel.com) e faça login com sua conta do GitHub.
2. Clique em **"Add New..."** > **"Project"**.
3. Selecione o repositório `diario-de-classe` que acabou de subir.
4. A Vercel detectará automaticamente o framework como **Vite**. O arquivo `vercel.json` já define tudo (não altere):
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build:web` (somente o front-end; o servidor Express é usado só em desenvolvimento / AI Studio)
   - **Output Directory**: `dist`
   - As funções da pasta `api/` (leitura de capas por IA e busca por ISBN) são publicadas automaticamente como *Vercel Functions* com limite de 60 s.
5. **Antes de clicar em Deploy**, abra **Environment Variables** e crie:
   - `GEMINI_API_KEY` = sua chave do [Google AI Studio](https://aistudio.google.com/apikey) *(obrigatória para a leitura de capa/contracapa por IA)*
   - `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` *(opcional; variáveis `VITE_*` são lidas no build)*
6. Clique em **Deploy**. Em menos de 1 minuto seu Diário de Classe estará online em HTTPS com domínio gratuito (`.vercel.app`)!
7. Confira a instalação abrindo `https://SEU-PROJETO.vercel.app/api/health` — deve responder `{"status":"ok","hasGeminiKey":true,...}`. Se `hasGeminiKey` vier `false`, a variável não foi definida (ou o deploy foi feito antes dela): crie a variável e use **Redeploy**.

---

### Opção 2: Versão em Arquivo Único (`app-unico.html`)

Você também pode utilizar o arquivo **`app-unico.html`** (localizado em `public/app-unico.html` ou baixado diretamente pelo painel):
- Todo o HTML, CSS (Tailwind) e JavaScript (React + Lucide + Firebase) estão compilados em **um único arquivo autossuficiente**.
- Pode ser aberto diretamente no navegador (dando duplo clique no arquivo), hospedado no **GitHub Pages**, ou servido em qualquer CDN / hospedagem estática básica sem precisar de servidor Node.js.
- ⚠️ Nessa versão **não há servidor**: a leitura de capa/contracapa por IA não funciona (a busca por ISBN usa o fallback direto no navegador). Para ter a IA, use a Opção 1 (Vercel).

---

## ⚙️ Configuração do Firebase Realtime Database

Para que o sistema salve os dados corretamente:
1. Acesse o [Firebase Console](https://console.firebase.google.com/).
2. Vá em **Authentication** > **Sign-in method** e habilite **E-mail/Senha**.
3. Vá em **Realtime Database** > aba **Regras** (Rules).
4. Copie o conteúdo do arquivo `database.rules.json` (ou visualize diretamente pelo botão no painel de administração do sistema) e clique em **Publicar**.

As regras de segurança (`database.rules.json` - 245 linhas) protegem todas as coleções segundo o princípio do menor privilégio (RBAC e vinculação estrita de turmas):
- `escolas`, `turmas`, `disciplinas`, `professores`, `admins`, `bibliotecarios`
- `chamada`, `notas`, `planos-aula`, `ocorrencias`
- `biblioteca`:
  - `livros` e `acervos`: patrimônio blindado para admins, bibliotecários e professores com delegação (`canManageLibrary`).
  - `emprestimos`: professores só operam empréstimos para alunos de turmas atribuídas a eles.
  - `cantinhos`: alocação e movimentação em sala restrita a turmas atribuídas.
  - `reservas` e `movimentacoes`: histórico e transferências documentadas.
- Validação contábil (Ledger): auditoria de exemplares em tempo real contra reservas fantasmas ou concorrência.

---

## 🔑 Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `GEMINI_API_KEY` | Sim (para IA) | Chave do Google AI Studio. Sem ela, a leitura por fotos e a complementação por IA ficam desativadas. |
| `GEMINI_SCAN_MODELS` | Não | Modelos da leitura de fotos, do preferido ao último recurso, separados por vírgula. Padrão: `gemini-3.6-flash,gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite`. |
| `GEMINI_TEXT_MODELS` | Não | Modelos usados só para complementar dados por texto (rota de ISBN). |
| `GOOGLE_BOOKS_API_KEY` | Não | Evita limite de requisições na consulta por ISBN em hospedagem compartilhada. |
| `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` | Não | Ativa o selo Turnstile no login (lida no build). |

Em desenvolvimento local, copie `.env.example` para `.env` e preencha.

---

## 🩺 Solução de Problemas — Leitura por IA

- **"O serviço de leitura por IA não foi encontrado neste servidor"**: o deploy não incluiu a pasta `api/` (confira se ela está no repositório) — abra `/api/health` para testar.
- **"A chave GEMINI_API_KEY não está configurada"**: crie a variável na Vercel e faça **Redeploy** (variáveis só valem para deploys novos).
- **Mensagem de ISBN descartado / campos incertos**: a foto está borrada, com reflexo ou cortada. Refaça a foto da contracapa de frente, com boa luz, com o código de barras inteiro no quadro.
- **"Fotos grandes demais" (HTTP 413)**: a Vercel limita cada requisição a ~4,5 MB. O sistema já comprime as fotos; se ocorrer, use fotos de resolução menor.
- **"Alta demanda" / limite de uso**: aguarde alguns segundos; o sistema já tenta automaticamente outros modelos da lista `GEMINI_SCAN_MODELS`.

---

## 🛠️ Comandos Disponíveis

- `npm run dev`: Inicia o servidor de desenvolvimento local na porta 3000.
- `npm run build`: Compila o front-end e o servidor Express (`dist/server.cjs`) para hospedagem Node.
- `npm run build:web`: Compila apenas o front-end para `dist/` (é o que a Vercel executa).
- `npm run build:singlefile`: Gera o executável único `public/app-unico.html`.
- `npm run pack`: Gera os pacotes de distribuição ZIP (`public/diario-de-classe-projeto.zip`) e o HTML único atualizado.
- `npm run lint`: Valida tipagens e sintaxe TypeScript.
