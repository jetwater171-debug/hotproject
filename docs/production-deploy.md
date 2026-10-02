# API de áudio em produção

## Deploy

`api/[...path].mjs` adapta o mesmo handler local para uma única função Node na Vercel. A função não inicia um listener e não carrega `.env` por arquivo. `vercel.json` executa o build Vite, publica `dist`, ativa Fluid Compute e inclui apenas o catálogo, o manifesto de gravações e `public/audio/` no bundle. As rotas `/api/audio/*` continuam iguais às usadas pelo frontend. O fallback da SPA não intercepta API, gravações estáticas ou arquivos do build.

Aplique `supabase/migrations/202610010001_audio_access.sql` no projeto correto antes de ativar chamadas pagas. Ela cria perfis com RLS, registros mínimos de consumo e duas RPCs restritas ao papel `service_role`. Uma migração ausente ou configuração inválida faz a geração falhar antes da ElevenLabs; não há fallback que ignore cotas.

Configure as variáveis abaixo no ambiente da Vercel. Não coloque chaves privadas em `VITE_*`, no repositório, em logs ou na interface:

| Variável | Uso |
| --- | --- |
| `SUPABASE_URL` | URL HTTPS do projeto usado para verificar sessões e consumo. |
| `SUPABASE_ANON_KEY` | Chave pública do projeto, usada pelo backend ao validar o token na Auth API. |
| `SUPABASE_SERVICE_ROLE_KEY` | Segredo somente no servidor; executa as RPCs de consumo. |
| `ELEVENLABS_API_KEY` | Segredo somente no servidor; gera voz, conversão e efeitos. |
| `ELEVENLABS_DEFAULT_VOICE_ID` | Opcional; voz inicial da conta. |
| `APP_ORIGINS` | Origens HTTPS permitidas, separadas por vírgula, incluindo domínio próprio se existir. |
| `AUDIO_DAILY_LIMIT` | Opcional, inteiro; padrão 10 operações pagas por pessoa por dia UTC. |
| `AUDIO_DAILY_UNITS` | Opcional, inteiro; padrão 15.000 unidades operacionais por pessoa por dia. |
| `AUDIO_GLOBAL_DAILY_LIMIT` | Opcional, inteiro; padrão 50 operações pagas no projeto por dia. |
| `AUDIO_GLOBAL_DAILY_UNITS` | Opcional, inteiro; padrão 75.000 unidades operacionais no projeto por dia. |

`VERCEL_URL` e `VERCEL_PROJECT_PRODUCTION_URL`, fornecidas pelo deploy, acrescentam seus domínios exatos à lista permitida. Não permitimos qualquer domínio `*.vercel.app`. O backend confere Host e Origin e não confia em `X-Forwarded-Host` fornecido pelo cliente. Uma origem explicitamente permitida recebe os headers CORS necessários para Authorization e Content-Type.

O frontend usa apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` públicas para autenticar. Cada chamada privada envia `Authorization: Bearer <access_token>` da sessão. Tokens, scripts e áudios não devem aparecer em logs. A configuração pública não substitui a validação do servidor.

## Sessão e consumo

`GET /api/audio/status` é público e retorna apenas capacidades, booleans de configuração e limites. Vozes, leitura de ambientes/IR/eventos e todos os POSTs de áudio exigem sessão em produção. O backend consulta `/auth/v1/user` com o token recebido: não confia em claims apenas decodificadas ou em um `userId` enviado no formulário. Contas anônimas ou banidas não podem usar a API. Na versão local, configurar URL e chave pública Supabase também habilita essa exigência; `AUDIO_REQUIRE_AUTH=true` permite exigir sessão antes mesmo de preencher a configuração.

Antes de uma chamada paga, o servidor reserva consumo com `reserve_audio_usage`. A RPC usa um lock transacional no Postgres para conferir os limites em conjunto, inclusive quando há múltiplas instâncias serverless. Há no máximo duas gerações pagas simultâneas no projeto. Uma reserva dura 150 segundos; a chamada ElevenLabs tem timeout de 120 segundos. Ao terminar, `finish_audio_usage` registra sucesso, falha ou timeout. Se a confirmação final falhar, a reserva expira sem liberar o consumo diário já aceito.

Os registros guardam somente UUID de solicitação, UUID do usuário, operação, unidades, estado e horários. Não guardam roteiro, voz gravada, nomes de arquivo, email, token ou chave. Os usuários podem ler apenas suas linhas por RLS e não podem inserir, atualizar ou excluir consumo. As RPCs de mutação não estão disponíveis para `anon` ou `authenticated`.

A cota conta tentativas aceitas antes do provedor, incluindo falhas e timeouts, pois uma resposta perdida não prova ausência de cobrança. Reutilizar uma gravação incluída ou um candidato já cacheado não reserva outra chamada paga. GETs e listagem de vozes não descontam gerações.

**Unidades são um orçamento técnico, não créditos vendidos, preço ou saldo financeiro.** Texto usa quantidade de caracteres; conversão e ambiente usam duração ponderada (`ceil(segundos × 1000 / 60)`). Esse fator permite limitar entradas sem prometer equivalência entre custos de modelos. Os limites individuais e globais são controles iniciais; planos e pagamentos exigem um ledger próprio antes de cobrança real.

## Arquivos e limites da Vercel

Uploads para uma função Vercel têm limite de 4,5 MB. Por isso a API de produção exige guia WAV PCM16 **mono, 16 kHz, até 120 segundos e 4 MiB**, deixando espaço para multipart. O frontend converte a gravação antes do envio. Localmente, os limites continuam 180 segundos e 30 MiB. `status.voiceChange` informa os valores efetivos. Não tentamos resolver um upload grande com retry automático.

Áudios de resposta usam streaming Node em blocos, preservando os headers de modelo, fonte e revisão. Isso evita responder um arquivo grande como payload buffered. O stream ainda respeita o timeout da função e o limite de arquivo do backend. O resultado completo da ElevenLabs é validado antes de começar a resposta; essa versão não oferece geração progressiva de voz.

O cache em produção fica em `/tmp/velora-ambience-cache`, é efêmero e pode desaparecer em cold starts ou entre instâncias. Ele armazena somente efeitos do catálogo público, gerados com prompts fixos. Não oferece persistência ou deduplicação entre instâncias. Nenhum roteiro, guia ou saída de voz privada é gravado pelo backend. A biblioteca local aprovada é desabilitada por padrão na função; gravações distribuídas vêm do manifesto e dos arquivos incluídos, com licença/hash e status de revisão preservados. Arquivos licenciados sob `public/audio/` são públicos e não contêm gravações privadas de usuários.

A Vercel permite bundle Node de até 250 MB no caminho padrão; os arquivos incluídos precisam caber junto ao código. O projeto usa duração máxima de 150 segundos com Fluid Compute. Uploads privados maiores, cache durável de IA ou processamento mais longo precisam de armazenamento e processamento próprios; não estão mascarados pelo cache efêmero.

## Verificação

Antes de afirmar produção pronta, confira o deploy READY e o domínio exato, a aplicação da migração e estas respostas: status sem segredo; acesso privado sem token recusado; token expirado recusado; vozes com sessão; leitura de gravação incluída sem gasto; cota recusada antes do provedor. A suíte automatizada usa mocks para essas condições e para multipart/streaming. Ela não substitui execução real da migração, permissões da conta, medição de cobrança ou escuta do áudio.

Fontes primárias: [limites Vercel](https://vercel.com/docs/functions/limitations), [Node e streaming](https://vercel.com/docs/functions/runtimes/node-js), [configuração de funções](https://vercel.com/docs/project-configuration/vercel-json), [verificação de usuário Supabase](https://supabase.com/docs/reference/javascript/auth-getuser) e [funções e privilégios no banco](https://supabase.com/docs/guides/database/functions).
