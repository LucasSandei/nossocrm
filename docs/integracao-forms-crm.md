# Integração LS Forms + LS CRM, com roteamento por origem

Guia completo do fluxo: o lead responde um formulário no LS Forms, chega no LS CRM
já no funil certo, com a coluna certa, a etiqueta certa e a vendedora certa.

O documento cobre os dois lados. Faça na ordem: o CRM primeiro, porque é dele que
saem os dois valores que o LS Forms precisa.

---

## Antes de começar: entenda os dois caminhos

O LS Forms sabe entregar o lead ao CRM de duas maneiras diferentes. A escolha é
feita por preenchimento: se você preencher o bloco "Roteamento por origem", ele usa
o caminho 2; se deixar em branco, usa o caminho 1.

| | Caminho 1: API pública | Caminho 2: Webhook de entrada |
|---|---|---|
| O que configura | Chave da API + funil fixo | Endereço do webhook + secret |
| Onde o lead cai | Sempre no mesmo funil | Decidido por regras, no CRM |
| Separa vendedoras | Não | Sim |
| Define etiqueta e dono | Não | Sim |
| Regras por score | Sim (`stageRules`) | Não |

**Para separar duas vendedoras que dividem o mesmo formulário, você precisa do
caminho 2.** É o único que carrega a origem do clique junto com o lead.

Os dois campos de origem que importam:

- **`link_id`**: o identificador do link de campanha. É estável e exato. Identifica
  *quem divulgou*.
- **`utm_source`, `utm_campaign` e as demais UTM**: texto digitado a cada publicação.
  Identificam *o canal e a campanha*, não a pessoa. Servem bem para regras amplas
  ("tudo que vem do Instagram"), mal para regras exatas.

Prefira `link_id` sempre que a pergunta for "de quem é este lead".

---

## Passo 1: criar a fonte de entrada no CRM

1. No LS CRM, abra **Configurações › Integrações**.
2. Encontre o bloco **Entrada de Leads (Webhook)**.
3. Se ainda não existir uma fonte, crie: escolha o **funil** e a **coluna** de
   entrada. Esse par é o destino padrão, usado quando nenhuma regra casar. Não é
   opcional, e é o que evita lead perdido.
4. Com a fonte criada, aparecem dois botões: **Copiar URL** e **Copiar secret**.

Guarde os dois. A URL tem este formato:

```
https://<seu-projeto>.supabase.co/functions/v1/webhook-in/<source_id>
```

O secret é gerado pelo CRM. Ele viaja em dois cabeçalhos (`X-Webhook-Secret` e
`Authorization: Bearer`), e o webhook aceita qualquer um dos dois. Você não precisa
fazer nada com isso: o LS Forms monta os cabeçalhos sozinho.

> Se você regenerar o secret depois, o LS Forms para de entregar até você colar o
> novo. Regenerar é uma ação de duas pontas.

---

## Passo 2: gerar um link de campanha por vendedora

1. No LS Forms, abra o formulário e vá em **Compartilhar**.
2. Na aba de links de campanha, crie **um link por vendedora**. Dê um rótulo que
   você reconheça depois ("Ana", "Naty").
3. Preencha as UTM se quiser, mas não dependa delas para separar as vendedoras.
4. Em cada link há dois botões de cópia:
   - **Copiar**: copia o link curto, que é o que a vendedora divulga.
   - **ID**: copia o identificador do link. **É este valor que vai na regra do CRM.**

O ID é um UUID, parecido com `c0ffee00-0000-4000-8000-000000000001`. Copie o de cada
vendedora e deixe anotado, você vai usar no passo 4.

> O link curto não serve na regra. Ele é só o endereço que redireciona. O que viaja
> junto com o lead é o ID.

---

## Passo 3: apontar o LS Forms para o webhook

1. Ainda no LS Forms, no mesmo formulário, vá em **Integrações**.
2. No cartão **LS CRM**, preencha:
   - **Chave da API**: gerada em Configurações › Integrações › aba API do LS CRM.
     Continua necessária.
   - No bloco **Roteamento por origem (opcional)**:
     - **Endereço do webhook de entrada**: a URL copiada no passo 1.
     - **Secret do webhook**: o secret copiado no passo 1.
3. **Funil de destino** e **Origem do contato** continuam valendo como reserva.
4. Confira o **Mapeamento de campos**: nome, e-mail e telefone precisam apontar para
   as perguntas certas. Lead sem nome nem telefone não é entregue.
5. Salve.

O bloco "Roteamento por origem" é um `fieldset` com legenda própria, logo abaixo da
Chave da API. Se você não estiver vendo esse bloco, veja a seção
"Não estou vendo os campos" no fim deste documento.

---

## Passo 4: criar as regras de entrada no CRM

Volte ao CRM, em **Configurações › Integrações › Entrada de Leads**. Abaixo dos
botões da fonte existe a seção **Automações de entrada**. Clique em **Nova regra**.

Preencha, para a Ana:

| Campo | Valor |
|---|---|
| Nome da regra | `Leads da Ana` |
| Quando o lead chegar com | `Link de campanha` · `é igual a` · `<ID do link da Ana>` |
| Funil | o funil da Ana |
| Coluna | a coluna de entrada dela |
| Responsável | Ana |
| Etiquetas | o que fizer sentido |
| Prioridade | `10` |

Repita para a Naty, com o ID do link dela e prioridade `20`.

### Como as regras são avaliadas

- Avaliação por **prioridade, do menor número para o maior**. A **primeira que casar
  vence** e a avaliação para ali. Por isso o destino de um lead sempre tem uma
  explicação única.
- Regras específicas primeiro, genéricas depois. Uma regra "pega-tudo" com prioridade
  baixa engoliria todas as outras.
- Uma regra **sem nenhuma condição** casa com todo lead da fonte. É legítimo como
  rede de segurança, mas só com prioridade alta.
- Se você usar mais de uma condição, aparece um seletor de **todas as condições** ou
  **qualquer uma**.
- Comparação de texto **ignora maiúsculas e minúsculas**. `Instagram` e `instagram`
  são a mesma coisa, o que importa porque a UTM é digitada à mão em cada publicação.
- Etiquetas são gravadas por **ID**, então renomear a etiqueta depois não quebra a
  regra.
- O **responsável é preenchido, nunca sobrescrito**. Se o card já tem dono, uma nova
  resposta do mesmo lead não tira o card de quem já está atendendo.
- Coluna que não pertence ao funil escolhido cai na primeira coluna daquele funil, em
  vez de criar um card invisível.

### Operadores disponíveis

| Operador | Quando usar |
|---|---|
| `é igual a` | O caso normal. Exige o valor exato. |
| `é diferente de` | Exclusão. "Tudo que não for o link da Ana". |
| `contém` | Casamento parcial, útil em `utm_campaign` com prefixo comum. |
| `existe (qualquer valor)` | Só verifica presença. Dispensa o campo de valor. |

### Campos de origem que o CRM sabe avaliar

`link_id` (Link de campanha), `form_id` (Formulário), `utm_source`, `utm_medium`,
`utm_campaign`, `utm_content`, `utm_term`, `utm_id`, `gclid`, `fbclid` e `source`
(Origem declarada, o campo "Origem do contato" da integração do LS Forms).

---

## Passo 5: testar antes de soltar os links

**Faça isto antes de mandar os links para as vendedoras.** Um erro descoberto aqui
custa um minuto; descoberto depois, custa leads misturados no funil.

1. Abra o link curto da Ana no navegador.
2. Responda o formulário com dados de teste.
3. Verifique no CRM se o card apareceu no funil da Ana, na coluna certa e com ela
   como responsável.
4. Repita com o link da Naty.

Se quiser conferir pelo lado técnico, a resposta do webhook traz um campo `routing`
que diz exatamente o que aconteceu:

```json
{
  "ok": true,
  "contact_id": "...",
  "deal_id": "...",
  "routing": {
    "rule_id": "...",
    "rule_name": "Leads da Ana",
    "matched": true,
    "board_id": "...",
    "stage_id": "...",
    "owner_id": "...",
    "tags": ["Instagram"]
  }
}
```

`matched: false` significa que nenhuma regra casou e o lead caiu no destino padrão da
fonte. A regra aplicada também fica gravada no card, em
`deals.custom_fields.inbound_rule_id`.

No LS Forms, o histórico de entregas fica na mesma página de Integrações, em
`integration_deliveries`, com status e mensagem de erro de cada tentativa.

---

## Diagnóstico

### Não estou vendo os campos de URL e secret no LS Forms

Esse bloco veio no commit `800b281`, que está na branch **`fluxo-visual`**, e essa
branch ainda não foi para `master`. Se o que você está acessando é a versão publicada
a partir de `master`, os campos realmente não existem lá.

Confirme com:

```bash
cd ls-forms
git branch --show-current
git log --oneline master..fluxo-visual | head
```

Para publicar, `fluxo-visual` precisa ser mesclada em `master` e implantada. Hoje ela
está **20 commits à frente** de `master` e tem **1 commit ainda não enviado** ao
remoto.

O mesmo vale do lado do CRM: o roteamento por origem está no commit `d99c9a9`, na
branch `chore/auditoria-fase-2`.

### Todos os leads caem no mesmo lugar

Em ordem de probabilidade:

1. O bloco "Roteamento por origem" está em branco no LS Forms, então a entrega está
   indo pelo caminho 1 (API pública, funil fixo) e as regras nem chegam a rodar.
2. A regra usa o link curto no lugar do ID do link.
3. Existe uma regra sem condições com prioridade baixa engolindo tudo.
4. A vendedora divulgou o endereço direto do formulário em vez do link curto. Sem o
   link curto não há `link_id`, e sem `link_id` a regra não casa.

### O lead chegou mas ficou sem responsável

O card já existia e já tinha dono. É o comportamento correto: o CRM preenche o
responsável, nunca o substitui.

### O lead não chegou

Verifique se nome e telefone estão mapeados corretamente. O LS Forms só entrega
quando tem os dois. Depois confira o histórico de entregas na página de Integrações.

---

## Resumo em uma tela

```
LS CRM                                LS FORMS
Configurações › Integrações           Formulário › Compartilhar
└─ Entrada de Leads (Webhook)         └─ um link por vendedora
   ├─ Copiar URL      ────────────┐      └─ botão "ID"  ──────────┐
   └─ Copiar secret   ──────────┐ │                               │
                                │ │                               │
                                ▼ ▼                               │
                       Formulário › Integrações › LS CRM          │
                       └─ Roteamento por origem                   │
                          ├─ Endereço do webhook                  │
                          └─ Secret do webhook                    │
                                                                  │
LS CRM                                                            │
Configurações › Integrações › Entrada de Leads                    │
└─ Automações de entrada › Nova regra                             │
   └─ Link de campanha · é igual a · <ID> ◄────────────────────────┘
      → funil, coluna, etiqueta, responsável
```
