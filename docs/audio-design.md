# Áudio com sensação de lugar

## Decisão

Gerar a voz limpa com **Eleven v3** ou transformar uma interpretação gravada com **Voice Changer Multilingual v2**, manter a faixa original e acrescentar uma cama sonora preparada para o cenário. O processamento local aplica o comportamento acústico do espaço à voz e equilibra as faixas. Um arquivo local aprovado tem prioridade sobre uma gravação incluída, que tem prioridade sobre um candidato de IA. Trocar volumes, distância ou acústica reutiliza as mesmas faixas.

O som precisa corresponder ao lugar; volume baixo, reverb e um prompt genérico não garantem isso. Por esse motivo, o catálogo define fontes específicas por ambiente e a biblioteca distingue **aprovado**, **gravação incluída sem revisão**, **candidato de IA** e **ausente**. A análise técnica não aprova o significado de um som. Essa decisão exige escuta.

## Cenários preparados no catálogo

| Ambiente | O que dá a sensação do lugar |
| --- | --- |
| Estúdio | Voz seca, próxima, sem cama sonora. |
| Banheiro | Reflexos curtos de azulejo; nenhum gotejamento obrigatório. |
| Quarto | Reflexos fracos, tecido e móveis absorvendo a voz. |
| Sala | Reflexos moderados e cauda curta; sem TV inventada. |
| Biblioteca | Espaço silencioso e reflexos leves; sem cochichos acrescentados. |
| Cozinha | Geladeira discreta, pequenos contatos de utensílios. |
| Escritório | Ventilação baixa, teclado distante e espaçado. |
| Elevador | Motor discreto, vibração e cabine pequena. |
| Garagem | Ventilação e ressonância de concreto. |
| Chuva | Gotas contínuas, perspectiva protegida; sem trovões. |
| Tempestade | Chuva forte e trovões distantes espaçados. |
| Floresta | Folhas e pássaros esparsos, espaço aberto. |
| Praia | Ondas se aproximando e recuando, espuma e brisa. |
| Rio | Água corrente e pequenas ondulações contínuas. |
| Lareira | Madeira queimando e estalos irregulares, sala acolhedora. |
| Noite | Insetos e movimento sutil da vegetação. |
| Vento | Rajadas variáveis em campo aberto. |
| Rua | Pneus e tráfego passando; sem eco de sala. |
| Café | Máquina de café, xícaras e conversas indistintas ao longe. |
| Restaurante | Talheres, louça e salão ocupado, sem máquina de café dominante. |
| Bar | Copos, gelo e movimento de pessoas, sem música obrigatória. |
| Festa | Movimento e vozes indistintas, sem música adicionada. |
| Shopping | Passos, escada rolante e átrio amplo. |
| Supermercado | Refrigeração e carrinho de compras. |
| Academia | Esteira e contatos metálicos, sem gritos ou música. |
| Carro | Interior em movimento, rodas e motor abafados. |
| Ônibus | Diesel, vibração do chassi e interior coletivo. |
| Metrô | Motor elétrico e atrito contínuo nos trilhos. |
| Trem | Rodas e juntas de trilhos com variação. |
| Avião | Cabine em cruzeiro, ventilação e ruído grave estável. |

Os cinco cenários silenciosos estão prontos para processar a voz sem nenhum arquivo ambiental. O catálogo pode crescer sem mudar os endpoints. Os outros cenários têm prompts e parâmetros distintos; o status da API informa quais já têm arquivos reais ou candidatos e quais continuam ausentes. Gravações incluídas em `shared/bundled-assets.json` são recursos com fonte, licença e hash conferidos, mas **não recebem aprovação auditiva automática**.

## Interpretação gravada

O modo guia envia um WAV de voz ao endpoint local `POST /api/audio/voice-change`. A ElevenLabs usa o conteúdo, o tempo e a expressão desse áudio para a conversão. O modelo usado é `eleven_multilingual_sts_v2`; essa operação não é Eleven v3 e não é tradução. O provedor lista português do Brasil e de Portugal e cobrança por tempo processado; não calculamos preço em reais neste backend. Use voz da conta, uma gravação com consentimento, um intérprete por guia e a performance que se deseja preservar. Não misture a cama sonora ao guia antes da conversão. [Capacidades oficiais](https://elevenlabs.io/docs/overview/capabilities/voice-changer).

O formulário multipart aceita somente `audio`, `voiceId`, `quality` (`standard` ou `high`) e `removeBackgroundNoise` (`true` ou `false`, padrão `false`). A API aceita WAV PCM16 mono/estéreo até 180 segundos e 30 MiB, verificando bytes, amostragem, tamanho e duração reais. Um WAV estéreo de 48 kHz chega ao limite de tamanho antes de 180 segundos; a interface adota um teto menor. Arquivos do microfone ou em outros formatos precisam ser decodificados e convertidos localmente para WAV antes do envio.

A conversão exige chave no servidor, solicitação explícita e créditos do provedor. O guia fica em memória durante a solicitação; o servidor não o grava em cache ou log. Não há repetição automática. A remoção de ruído é opcional porque processa o áudio guia. Guarde o original e compare a fala, as pausas e a expressividade antes de aprovar o resultado. O timeout local é de dois minutos. [Contrato oficial do Voice Changer](https://elevenlabs.io/docs/api-reference/speech-to-speech/convert).

## Respostas de sala e eventos

Uma resposta de sala real (IR) é um WAV PCM ou float mono/estéreo de **até 4 segundos**, com a licença e o tratamento do som direto documentados. Eventos ocasionais são WAVs de até 15 segundos. O suporte da biblioteca não fabrica arquivos: um recurso ausente continua ausente. Importações locais começam como rascunhos; `--approve` é a declaração de revisão por quem executa o comando. Recursos incluídos com licença pública podem ser lidos como candidatos sem aprovação auditiva.

Para uma IR, crie um JSON de metadados como este, usando dados verdadeiros da captura ou do arquivo:

```json
{
  "directSound": "included",
  "directArrivalMs": 0,
  "directWindowMs": 5,
  "predelayMode": "embedded",
  "predelayMs": 0,
  "wet": 0.15,
  "notes": "Descreva a fonte, posição de captura e qualquer recorte ou tratamento."
}
```

`directSound` aceita `included` ou `removed`. `directArrivalMs` e `directWindowMs` são opcionais e devem refletir o som direto realmente presente, não uma estimativa de licença ou de nome do arquivo. `predelayMode: embedded` preserva o tempo do WAV sem somar atraso adicional; `external` aplica `predelayMs` separado. `wet` é opcional. O campo `notes` é obrigatório; um recorte de cauda precisa ser documentado e produz outro hash.

```powershell
npm run audio:library -- --environment bathroom --kind ir --file "C:\audio\room.wav" --license owned --source "Gravação própria e posição" --metadata "C:\audio\ir.json"
# Depois de ouvir e conferir os metadados, repita o comando com --approve.
```

Para um evento, o JSON é `{ "label": "Porta distante", "minGapSeconds": 25, "maxGapSeconds": 60, "relativeDb": -24, "pan": -0.2 }`. Esses valores descrevem espaçamento, volume relativo à fala e posição; não iniciam nenhuma geração. Registre com `--kind event --event door --metadata "C:\audio\event.json"`, mais arquivo, ambiente, licença, procedência e aprovação quando realmente revisado.

O manifesto local mantém `entries` para camas e acrescenta `resources.ir[environment]` e `resources.events[environment][eventId]`. Licenças aceitas: `owned`, `cc0`, `mit` e `elevenlabs`; escolher um rótulo não concede direitos sobre um arquivo. Os binários são copiados atomicamente para a pasta local, com hash, MIME, tamanho e duração verificados. Um rascunho não pode substituir um recurso aprovado.

`GET /api/audio/ir/:environment` e `GET /api/audio/events/:environment/:eventId` são somente leitura. Recursos inexistentes retornam `AUDIO_RESOURCE_NOT_READY` e nunca acionam o provedor. `GET /api/audio/environments` acrescenta `resources` quando há algo disponível: uma IR e uma lista de eventos com metadados públicos. O header `X-Audio-Resource-Metadata` usa `encodeURIComponent(JSON.stringify(metadata))`; o cliente aplica `JSON.parse(decodeURIComponent(header))`.

## Gravações incluídas

O manifesto `shared/bundled-assets.json` tem `version: 1`, `beds` e, opcionalmente, `irs`. Cada entrada traz `environment`, `id`, `file` relativo a `public`, `source` HTTPS pública, `license`, `sha256`, `label`, `reviewed: false` e `licenseUrl` quando disponível. IRs incluem também `acoustic` no contrato acima. Camas aceitam CC0; IRs aceitam CC0 ou MIT, com referência pública à licença MIT. Preserve os avisos exigidos pela licença junto ao arquivo distribuído.

A API lê o manifesto local, confere arquivo regular, confinamento dentro de `public/audio/`, ausência de symlink, assinatura de áudio e hash. Para IR verifica também formato/duração e metadados acústicos. Não baixa arquivos por esses endpoints. As camas incluídas aparecem como `status: recorded`, `source: recording`, `reviewed: false`; a procedência pública acompanha a resposta e o header `X-Ambience-Provenance` com a mesma codificação de JSON. Caminhos privados da biblioteca não são expostos. `audio:prepare` reconhece essas gravações e não solicita geração paga para substituí-las.

## Preparação e aprovação

1. Rode `npm run audio:prepare` para consultar o plano. Não gera mídia nem consome créditos.
2. Com a chave configurada, use `npm run audio:prepare -- --generate` para gerar somente os fundos ausentes. O processo é sequencial, retomável e não repete chamadas com erro automaticamente.
3. Ouça cada candidato sozinho, durante a fala e na volta do loop. Rejeite música não solicitada, palavras compreensíveis, eventos dominantes ou fontes que pertençam a outro cenário.
4. Ouça também no celular e em mono: a voz deve continuar compreensível e o fundo deve continuar presente sem cobri-la.
5. Registre um arquivo revisado com `npm run audio:library -- --help`. Informe fonte e licença verdadeiras; `--approve` registra a aprovação de quem ouviu. Uma gravação própria é uma boa alternativa quando a IA não entrega o lugar desejado.

O cache guarda candidatos. A biblioteca guarda arquivos com procedência e aprovação. A chave fica no servidor e não aparece nesses metadados. A prévia ilustrativa do navegador permanece separada da preparação e nunca substitui um fundo ausente no áudio final.

## Processamento

- RMS ativo da voz serve de referência, com limites de ganho para não ampliar demais gravações baixas ou ruidosas.
- A cama sonora parte de um nível relativo à voz específico do cenário. O slider controla esse equilíbrio; ducking suave reduz o fundo enquanto há fala.
- O loop recebe transição e posição inicial estável para não mudar de trecho a cada ajuste do mix.
- Reflexos iniciais e cauda variam por cenário. Em lugares abertos, afastar o microfone não introduz uma reverberação de sala.
- A voz inteira é preservada com espaço para a cauda. O arquivo final usa PCM16 estéreo a 48 kHz, com limite de pico de amostra em −1 dBFS.

Não medimos LUFS nem true peak nesta versão. Aumentar a taxa de amostragem e exportar WAV não recupera informação que o MP3 original perdeu. A acústica é aproximada; o resultado precisa ser ouvido em vozes e roteiros reais antes de considerar um preset aprovado.

## Pesquisa que orientou a implementação

- [Sound Effects: capacidades](https://elevenlabs.io/docs/overview/capabilities/sound-effects) e [contrato de geração](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert): Sound Effects v2, loop nativo, duração e influência do prompt. Usamos 24–30 segundos para reduzir repetição perceptível; esses valores são um ponto de partida, não uma garantia de qualidade.
- [TTS Playground](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech): controles específicos do Eleven v3. Removemos parâmetros numéricos de velocidade e similaridade do payload v3.
- [Direções de interpretação no v3](https://elevenlabs.io/blog/v3-audiotags): tags visíveis no roteiro, sem alterações ocultas no texto do usuário.
- [Web Audio: convolução](https://www.w3.org/TR/webaudio/#the-convolvernode-interface): processamento local de reflexos e reverberação.
- [EBU R128](https://tech.ebu.ch/publications/r128): loudness e true peak exigem medição própria; RMS e pico de amostra não são equivalentes.
- [CC0](https://creativecommons.org/publicdomain/zero/1.0/) e [termos da API Freesound](https://freesound.org/docs/api/terms_of_use.html): procedência por arquivo e acesso comercial à API são questões diferentes. Não incorporamos um catálogo remoto sem verificar seus termos.

## Verificado nesta etapa

Os testes automatizados usam fixtures e não gastam créditos. Build e testes técnicos validam contratos e processamento local; não comprovam a qualidade dos resultados ElevenLabs. Sem uma conversão real solicitada e sem escuta dos arquivos incluídos, a aprovação sonora final continua pendente.
