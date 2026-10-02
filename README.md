# Velora Studio

Estúdio criativo com React, TypeScript e Vite, API Node.js local ou na Vercel e integração de áudio com ElevenLabs. Nome provisório: **Velora**. A interface usa preto, vermelho, vidro escuro e componentes reais do React Bits.

## Vercel e Supabase

A API de produção usa uma única função, sessão Supabase verificada e cotas atômicas no banco antes de chamadas pagas. Aplique [a migração](supabase/migrations/202610010001_audio_access.sql) e configure as variáveis privadas somente no servidor. Veja [o guia de produção](docs/production-deploy.md) para os domínios permitidos, configuração Vercel, limites de upload e verificação do deploy.

As cotas iniciais são 10 operações pagas por pessoa/dia e 50 no projeto/dia, com orçamento de processamento e duas gerações simultâneas. São limites operacionais; não representam créditos vendidos ou pagamentos. Guia em produção usa WAV PCM16 mono de 16 kHz, até 120 segundos/4 MiB. O cache serverless é efêmero e contém somente ambientes do catálogo público; vozes, roteiros e guias privados não são persistidos pela API.

## Rodar localmente

Use **Node.js 24**. Na pasta do projeto:

```powershell
npm install
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Abra `.env.local` em um editor e preencha `ELEVENLABS_API_KEY` com a chave da sua conta. `ELEVENLABS_DEFAULT_VOICE_ID` é opcional; use o ID de uma voz disponível na conta. Mantenha a chave somente nesse arquivo, sem prefixo `VITE_`, sem colocá-la no frontend, em commits ou em capturas de tela. Não é necessário imprimir a chave no terminal.

```powershell
npm run dev
```

Esse comando inicia a interface e a API juntas. Abra [http://127.0.0.1:5173](http://127.0.0.1:5173). A API escuta somente em `127.0.0.1:8787`; `PORT` permite alterar a porta da API e o proxy acompanha a configuração. As portas da interface e do preview são fixas, sem troca automática quando estiverem ocupadas. Reinicie o comando depois de alterar `.env.local`.

A configuração existente do processo tem prioridade sobre `.env.local`, que tem prioridade sobre `.env`. Sem chave, a interface, a edição local de imagens, a importação de áudio e as prévias sintéticas continuam disponíveis; a geração com ElevenLabs fica indisponível.

Para abrir o build com a própria API local:

```powershell
npm run build
npm start
```

Abra [http://127.0.0.1:8787](http://127.0.0.1:8787), ou a porta configurada em `PORT`. `npm start` serve os arquivos de `dist/` e os endpoints de áudio no mesmo servidor.

Para usar o preview do Vite, mantenha a API em outro terminal:

```powershell
# Terminal 1
npm run dev:api
# Terminal 2, depois de npm run build
npm run preview
```

O preview fica em [http://127.0.0.1:4173](http://127.0.0.1:4173). `npm run dev:web` inicia apenas a interface; também precisa da API separada para acessar ElevenLabs.

## O que já funciona

- Dashboard, navegação animada, busca global, ajuda e layout responsivo.
- Tela de acesso/cadastro demonstrativa em `/#/welcome`, com validação e entrada como visitante; acessível pelo menu do perfil ou navegação mobile.
- Upload de JPG, PNG e WebP; filtros locais com intensidade; recorte central por formato; comparação e exportação em JPG.
- AudioStudio com roteiros, vozes da conta ElevenLabs, amostras, paginação, interpretação natural/consistente/expressiva, direções de fala inseridas no texto e seleção de qualidade.
- Geração de voz com **Eleven v3**, conversão de uma interpretação gravada com **Voice Changer Multilingual v2** e ambientes com **Sound Effects v2**, por uma API local que guarda a chave no servidor.
- Catálogo compartilhado de ambientes com ícones SVG próprios, assinatura sonora e acústica específica: cenários com cama sonora e cinco silenciosos, representados pelo tratamento da voz. A lista é extensível, sem limite fixo nos endpoints.
- Importação de áudio de até 30 MB e 3 minutos, sujeita aos formatos que o navegador consegue decodificar.
- Mix local com calibração por RMS ativo, volumes independentes, reflexões por cenário, distância, largura estéreo moderada, transição de loop e ducking suave. Exportação em **WAV PCM de 16 bits, estéreo, 48 kHz**.
- Voz e ambiente armazenados separadamente, junto com o mix final, em IndexedDB. A biblioteca pode reabrir os projetos salvos e ajustar o mix sem gerar outra voz.
- Biblioteca de ambientes com arquivos locais revisados, gravações incluídas com fonte/licença/hash e candidatos de IA cacheados. Gravações incluídas são candidatas ainda sem revisão auditiva. A prévia real toca o mesmo fundo usado no mix. A alternativa “Prévia ilustrativa” é sintetizada localmente e nunca entra automaticamente no áudio final.
- Biblioteca local para respostas de sala reais (WAV mono/estéreo até 4 segundos) e eventos ocasionais (WAV até 15 segundos), com procedência, licença e metadados de acústica explícitos. Endpoints de leitura não geram mídia.
- Catálogo atual: **37 lugares**, sendo cinco acústicos sem fundo. Inclui **12 gravações CC0** e **quatro respostas de sala MIT**, disponíveis localmente sem chave. Os outros 20 fundos ainda precisam ser importados ou gerados. A lista de fontes e alterações acompanha os arquivos em [public/audio/SOURCES.md](public/audio/SOURCES.md); todas as gravações incluídas continuam sem aprovação auditiva.
- Biblioteca com busca, filtros, favoritos, visualização em lista/grade, download e exclusão confirmada.
- Perfis criativos com criação/edição local e seleção de referências.
- Planos com seleção mensal/anual e resumo; configurações, movimento reduzido e exportação de dados JSON.

## Limites desta versão

- A integração de áudio está implementada, mas **a geração real ainda não foi testada nesta etapa** e precisa de uma chave configurada. Testes com mocks verificam o contrato e os fluxos locais; não comprovam qualidade ou cobrança do provedor.
- As gerações e a conversão de voz usam os créditos da conta ElevenLabs. A API não repete automaticamente solicitações. Os fundos gerados usam loops de 24 ou 30 segundos, com cache por versão/modelo/prompt/parâmetros e deduplicação. Os cinco cenários silenciosos não geram efeito pago. Um som novo pode consumir créditos; ajustar o mix ou reutilizar um fundo preparado não gera outra voz nem outro efeito. Gravações locais aprovadas têm prioridade sobre gravações incluídas e sobre o cache de IA.
- A fonte da ElevenLabs é MP3 a 44,1 kHz: 128 kbps no padrão e 192 kbps na qualidade alta, que exige plano **Creator ou superior**. Exportar o mix em WAV de 48 kHz não recupera informação já perdida pela compressão do MP3.
- A naturalidade depende da voz, do roteiro, da interpretação, da acústica e do resultado do provedor. Os prompts por cenário são pontos de partida. O cache de IA e as gravações incluídas contêm candidatos ainda não revisados; é necessário ouvir e aprovar/substituir os fundos. O status mostra quais cenários têm arquivos e quais ainda precisam de preparação. Sem fundo preparado e sem conexão, o estúdio preserva a voz e informa o que falta; não usa uma imitação sintética no mix final.
- Voice Changer usa `eleven_multilingual_sts_v2`, separado do Eleven v3. O guia aceita WAV PCM16 até 180 segundos e 30 MiB na API; a interface pode limitar a duração para caber nesse teto. O servidor não guarda o guia em cache e não coleta uma gravação automaticamente. A conversão exige uma ação explícita do usuário.
- Eleven v3 usa estabilidade e direções no roteiro. O controle de velocidade numérico foi removido porque a documentação específica do v3 não o suporta. Tags como `[whispers]` e `[slowly]` orientam a interpretação, com resultado dependente da voz; não garantem tempos exatos.
- O teto de saída é **−1 dBFS de pico de amostra**. A calibração por RMS não é uma medição LUFS e não comprova true peak ou conformidade EBU R128. Os presets acústicos são aproximações, não medições de salas reais.
- Acesso/cadastro, planos e saldo são demonstrativos. Autenticação real, cobrança, ledger de créditos e geração/edição de imagens com IA ainda serão implementados. O editor de imagens aplica filtros e recorte locais; não executa o prompt nem usa Seedream.
- Metadados, preferências e referências ficam no localStorage; arquivos de áudio e faixas separadas ficam no IndexedDB deste navegador. Não há sincronização em nuvem. Limpar os dados do navegador remove os projetos locais; quotas podem impedir salvamentos grandes. O JSON de exportação não substitui o backup dos arquivos WAV.
- Fotografias de exemplo são referências do Unsplash, não resultados de IA nem identidades das pessoas fictícias da interface. Imagens e fontes remotas precisam de conexão.

## API e organização

O shell está em `src/App.tsx`; páginas e estúdios em `src/features/`. `src/audio/` contém o cliente da API, o processamento local e o armazenamento de áudio. `shared/environments.json` é o catálogo usado pela interface e pelo servidor. `server/index.mjs` inicia o backend HTTP nativo, sem Express; `server/audio-handler.mjs` valida os dados e chama a ElevenLabs.

| Endpoint | Função |
| --- | --- |
| `GET /api/audio/status` | Informa se a chave está configurada e quais modelos são usados; não devolve a chave. |
| `GET /api/audio/voices?nextPageToken=…` | Lista vozes com paginação; aceita também `search` e `language`. |
| `POST /api/audio/speech` | Recebe `text`, `voiceId`, `mood` e `quality`; devolve MP3 com Eleven v3. |
| `POST /api/audio/voice-change` | Multipart com `audio` WAV PCM16, `voiceId`, `quality` e `removeBackgroundNoise`; devolve MP3 com Multilingual STS v2. |
| `GET /api/audio/environments` | Lista ambientes silenciosos, aprovados, gravações incluídas, candidatos gerados ou ausentes; informa recursos de cena disponíveis. |
| `GET /api/audio/ambience/:id` | Lê arquivo aprovado, gravação incluída ou candidato cacheado. Nunca inicia geração paga. |
| `POST /api/audio/ambience` | Reutiliza arquivo aprovado, gravação incluída ou cache; gera apenas o fundo solicitado quando ausente. Cenários silenciosos não chamam o provedor. |
| `GET /api/audio/ir/:environment` | Lê uma resposta de sala revisada ou incluída com metadados explícitos. Sem arquivo retorna `AUDIO_RESOURCE_NOT_READY`. |
| `GET /api/audio/events/:environment/:eventId` | Lê um evento local aprovado. Nunca gera arquivos nem cobra por prévia. |

Solicitações POST exigem JSON, exceto `/voice-change`, que recebe `multipart/form-data`. O servidor valida Host/Origin local, limita chamadas simultâneas ao provedor a duas e usa timeout de dois minutos. Erros são devolvidos como `{ "error": { "code": "…", "message": "…" } }`, sem repassar mensagens brutas do provedor. O cache de ambientes fica em `.cache/audio/` e não contém chaves nem roteiros dos usuários.

Contratos oficiais: [texto para voz](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), [Voice Changer](https://elevenlabs.io/docs/api-reference/speech-to-speech/convert), [efeitos sonoros](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) e [lista de vozes](https://elevenlabs.io/docs/api-reference/voices/search).

## Preparar os sons dos ambientes

Este comando inspeciona os arquivos locais e incluídos do catálogo e mostra o plano, sem precisar da API, sem geração nem gasto:

```powershell
npm run audio:prepare
```

Com a API rodando e a chave configurada, a execução explícita abaixo prepara os fundos ausentes, um por vez, reaproveitando o cache. Cada novo fundo é uma chamada paga; eles continuam como candidatos até serem ouvidos e aprovados:

```powershell
npm run audio:prepare -- --generate
```

Use `npm run audio:library -- --help` para registrar gravações próprias, CC0, MIT ou resultados ElevenLabs. O registro guarda fonte, licença, hash e aprovação. `--kind ir --metadata arquivo.json` registra uma resposta de sala; `--kind event --event ID --metadata arquivo.json` registra um evento. Consulte [o desenho de áudio e os cenários](docs/audio-design.md) para os contratos, o fluxo de preparação e a escuta.

Para aprovar um candidato já ouvido, sem baixar novamente:

```powershell
npm run audio:library -- --environment rain --cached --approve
```

Esse comando registra a revisão feita por quem executa; não analisa nem escuta o som automaticamente. Para reduzir repetição, prefira gravações contínuas de até 180 segundos. A interface também aceita os loops gerados de 24–30 segundos. Arquivos e manifesto locais ficam em `server/ambience-library/`, ignorados pelo Git. Atualize a biblioteca no estúdio depois de registrar um arquivo.

Os componentes do React Bits estão em `src/components/reactbits/`, com origem e licença em `THIRD_PARTY_NOTICES.md`.

## Verificar

```powershell
npm test
npm run build
```

`npm test` usa chamadas de rede simuladas e verificações numéricas do processamento de áudio, sem chamar a ElevenLabs nem gastar créditos. `npm run build` verifica TypeScript e gera `dist/`. Para validar geração, permissões, saldo e resultado sonoro reais, é necessária uma chave configurada e uma geração solicitada pelo usuário.
