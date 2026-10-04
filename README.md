# Velora Studio

Estúdio criativo com React, TypeScript e Vite, API Node.js local ou na Vercel e integração de áudio com ElevenLabs. Nome provisório: **Velora**. A interface usa preto, vermelho, vidro escuro e componentes reais do React Bits.

## Vercel e Supabase

A API de produção usa uma única função, sessão Supabase verificada e cotas atômicas no banco antes de chamadas pagas. Aplique [a migração](supabase/migrations/202610010001_audio_access.sql) e configure as variáveis privadas somente no servidor. Veja [o guia de produção](docs/production-deploy.md) para os domínios permitidos, configuração Vercel, limites de upload e verificação do deploy.

As cotas iniciais são 10 operações pagas por pessoa/dia e 50 no projeto/dia, com orçamento de processamento e duas gerações simultâneas. São limites operacionais; não representam créditos vendidos ou pagamentos. Guia em produção usa WAV PCM16 mono de 16 kHz, até 120 segundos/4 MiB; a conversão sem compressão aceita guia de até 80 segundos. O cache serverless é efêmero e contém somente ambientes do catálogo público; vozes, roteiros e guias privados não são persistidos pela API.

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
- Acesso/cadastro com email e senha pelo Supabase; o estúdio exige uma sessão de conta válida e não oferece entrada como visitante.
- Upload de JPG, PNG e WebP; filtros locais com intensidade; recorte central por formato; comparação e exportação em JPG.
- AudioStudio com roteiros, vozes da conta ElevenLabs, amostras, paginação, interpretação natural/consistente/expressiva, direções de fala inseridas no texto e seleção de qualidade.
- Botão “Voz do seu Telegram” quando o ID `vcYWBf5QTtDLdbfB20xT` está disponível na lista da conta; seleciona essa voz com estabilidade **Natural**. O roteiro aprovado é enviado inteiro, sem limpeza, acréscimos ou tags ocultas.
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

- A geração depende de uma chave privada configurada, sessão válida e saldo no provedor. Testes com mocks verificam contratos e fluxos; não comprovam qualidade sonora, permissões ou cobrança de uma conta real.
- As gerações e a conversão de voz usam os créditos da conta ElevenLabs. A API não repete automaticamente solicitações. Os fundos gerados usam loops de 24 ou 30 segundos, com cache por versão/modelo/prompt/parâmetros e deduplicação. Os cinco cenários silenciosos não geram efeito pago. Um som novo pode consumir créditos; ajustar o mix ou reutilizar um fundo preparado não gera outra voz nem outro efeito. Gravações locais aprovadas têm prioridade sobre gravações incluídas e sobre o cache de IA.
- **Sem compressão** é o padrão da interface: a ElevenLabs devolve `pcm_24000` mono de 16 bits; o backend acrescenta somente o cabeçalho WAV e preserva cada amostra recebida. TTS aceita até **1.200 caracteres**, e Voice Changer, guia de até **80 segundos** nessa qualidade. O WAV da voz tem teto de **4 MiB**, também no modo local. O modo **Arquivo compacto** usa MP3 de 128 kbps a 44,1 kHz e permite roteiros de até 3.000 caracteres na interface. `high`/MP3 de 192 kbps permanece compatível na API, exige **Creator ou superior** e não é oferecido na interface configurada para Starter. PCM de 24 kHz é compatível com Starter; não solicitamos PCM de 44,1 kHz, que exige Pro ou superior. [Formatos e planos oficiais](https://help.elevenlabs.io/hc/en-us/articles/15754340124305-What-audio-formats-do-you-support).
- O limite de caracteres não garante duração exata. O backend interrompe a leitura se a saída sem compressão ultrapassar 4 MiB e retorna `lossless_audio_too_long`, sem cortar a fala ou repetir a geração em MP3. Essa tentativa já pode consumir saldo do provedor. Para tentar novamente, o usuário escolhe explicitamente um trecho menor ou Arquivo compacto. Exportar um MP3 em WAV de 48 kHz não recupera informação perdida pela compressão.
- A naturalidade depende da voz, do roteiro, da interpretação, da acústica e do resultado do provedor. Os prompts por cenário são pontos de partida. O cache de IA e as gravações incluídas contêm candidatos ainda não revisados; é necessário ouvir e aprovar/substituir os fundos. O status mostra quais cenários têm arquivos e quais ainda precisam de preparação. Sem fundo preparado e sem conexão, o estúdio preserva a voz e informa o que falta; não usa uma imitação sintética no mix final.
- Voice Changer usa `eleven_multilingual_sts_v2`, separado do Eleven v3. A interface aceita guia de até 120 segundos/30 MB e prepara WAV PCM16 mono de 16 kHz antes do envio. A API de produção limita o upload a 120 segundos/4 MiB; o backend local mantém compatibilidade com WAV de até 180 segundos/30 MiB. Para `quality: lossless`, ambos recusam guia acima de 80 segundos antes de chamar o provedor. O servidor não guarda o guia em cache e não coleta uma gravação automaticamente. A conversão exige uma ação explícita do usuário.
- Eleven v3 recebe somente `stability` em `voice_settings`: Natural `0.5`, Consistente (`soft`) `1` e Expressiva `0`. Não enviamos velocidade, similaridade, speaker boost ou o preset de estilo do Telegram como ajustes de naturalidade do v3. Direções inseridas pelo usuário permanecem visíveis no roteiro; o resultado depende da voz e não garante pausas com duração exata. O payload usa `language_code: pt`; prefira uma voz brasileira para o sotaque desejado. A normalização do provedor fica em `auto`, sem reescrita local do texto.
- O teto de saída é **−1 dBFS de pico de amostra**. A calibração por RMS não é uma medição LUFS e não comprova true peak ou conformidade EBU R128. Os presets acústicos são aproximações, não medições de salas reais.
- A autenticação usa Supabase. Planos e saldo da interface são demonstrativos; cobrança, ledger de créditos e geração/edição de imagens com IA ainda serão implementados. O editor de imagens aplica filtros e recorte locais; não executa o prompt nem usa Seedream.
- Metadados, preferências e referências ficam no localStorage; arquivos de áudio e faixas separadas ficam no IndexedDB deste navegador. Não há sincronização em nuvem. Limpar os dados do navegador remove os projetos locais; quotas podem impedir salvamentos grandes. O JSON de exportação não substitui o backup dos arquivos WAV.
- Fotografias de exemplo são referências do Unsplash, não resultados de IA nem identidades das pessoas fictícias da interface. Imagens e fontes remotas precisam de conexão.

## API e organização

O shell está em `src/App.tsx`; páginas e estúdios em `src/features/`. `src/audio/` contém o cliente da API, o processamento local e o armazenamento de áudio. `shared/environments.json` é o catálogo usado pela interface e pelo servidor. `server/index.mjs` inicia o backend HTTP nativo, sem Express; `server/audio-handler.mjs` valida os dados e chama a ElevenLabs.

| Endpoint | Função |
| --- | --- |
| `GET /api/audio/status` | Informa modelos, disponibilidade e limites de TTS/guia lossless; não devolve a chave. |
| `GET /api/audio/voices?nextPageToken=…` | Lista vozes com paginação; aceita também `search` e `language`. |
| `POST /api/audio/speech` | Recebe `text`, `voiceId`, `mood` e `quality`; Eleven v3 devolve WAV PCM16 de 24 kHz para `lossless` (padrão quando omitido) ou MP3 para `standard`/`high`. |
| `POST /api/audio/voice-change` | Multipart com `audio` WAV PCM16, `voiceId`, `quality` e `removeBackgroundNoise`; Multilingual STS v2 devolve WAV PCM16 de 24 kHz ou MP3. Omitir `quality` mantém `standard` por compatibilidade. |
| `GET /api/audio/environments` | Lista ambientes silenciosos, aprovados, gravações incluídas, candidatos gerados ou ausentes; informa recursos de cena disponíveis. |
| `GET /api/audio/ambience/:id` | Lê arquivo aprovado, gravação incluída ou candidato cacheado. Nunca inicia geração paga. |
| `POST /api/audio/ambience` | Reutiliza arquivo aprovado, gravação incluída ou cache; gera apenas o fundo solicitado quando ausente. Cenários silenciosos não chamam o provedor. |
| `GET /api/audio/ir/:environment` | Lê uma resposta de sala revisada ou incluída com metadados explícitos. Sem arquivo retorna `AUDIO_RESOURCE_NOT_READY`. |
| `GET /api/audio/events/:environment/:eventId` | Lê um evento local aprovado. Nunca gera arquivos nem cobra por prévia. |

Solicitações POST exigem JSON, exceto `/voice-change`, que recebe `multipart/form-data`. Em produção, todos os endpoints de áudio, exceto o status público, exigem Bearer de uma sessão Supabase verificada. O servidor valida Host/Origin permitido, reserva a cota antes da chamada paga, limita chamadas simultâneas ao provedor a duas e usa timeout de dois minutos. Erros são devolvidos como `{ "error": { "code": "…", "message": "…" } }`, sem repassar mensagens brutas do provedor. Não há retry pago nem troca automática de formato. O cache de ambientes fica em `.cache/audio/` no backend local e em `/tmp` efêmero na Vercel; não contém chaves nem roteiros dos usuários.

TTS e Voice Changer devolvem `Content-Type: audio/wav` para lossless ou `audio/mpeg` para MP3, com `X-Voice-Model`, `X-Speech-Format`, `X-Speech-Container` e `X-Speech-Sample-Rate`; WAV inclui `X-Speech-Bit-Depth: 16`. `GET /api/audio/status` informa `speech.losslessMaxChars`, `speech.losslessMaxBytes` e `voiceChange.losslessMaxDurationSeconds`. O backend rejeita limites de texto/guia antes da reserva de cota e mede os bytes reais da resposta durante a leitura. O roteiro não é truncado para caber na qualidade selecionada.

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
