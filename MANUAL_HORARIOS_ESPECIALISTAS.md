# 📅 Manual da Sugestão Automática de Horários para Especialistas

Guia operacional e técnico do módulo de planejamento automático de horários para professores especialistas (Arte, Educação Física, Informática e demais disciplinas da base diversificada).

---

## 🎯 Objetivo do Módulo

Auxiliar a coordenação pedagógica a montar, **por unidade escolar** e de forma rápida e livre de conflitos, a distribuição semanal das aulas dos especialistas antes da aprovação definitiva no **Quadro de Horários Oficial**.

> ⚠️ **Funcionalidade Independente:** Toda simulação acontece em memória. O quadro oficial (`turmas/{id}/gradeHoraria`) **não é alterado** até que um administrador clique em **"Aprovar & Gravar no Quadro Oficial"**.

---

## 📋 Regras de Negócio Aplicadas

1. **Escopo por Unidade Escolar, Turno e Atribuições**:
   - O planejamento é gerado individualmente para a escola selecionada, podendo filtrar por **Todos os Turnos** ou por um turno específico (**Manhã / Matutino**, **Tarde / Vespertino** ou **Noite / Noturno**).
   - Especialistas que **não possuem turmas atribuídas** naquele escopo (escola + ano letivo + turno) são automaticamente excluídos.
   - O vínculo de atribuições cruza todas as chaves do docente (`id`, `authUid` e correspondência por e-mail) e considera `tipoDocente === 'especialista'` além da disciplina.
   - As abas de conferência e a lista de aplicação ao quadro oficial exibem exclusivamente as turmas que efetivamente possuem especialistas regulares atribuídos.

2. **Filtro Estrito por Ano Letivo**:
   - Apenas turmas pertencentes ao **Ano Letivo Alvo** (ex.: `2026`) participam do cálculo.
   - Atribuições ou turmas de outros anos (ex.: `2027`) não são consideradas.

3. **Carga `Regular` vs. `Carga Suplementar`**:
   - Cada turma atribuída a um especialista pode ser classificada como:
     - **`🎓 Regular`**: entra normalmente no cálculo da sugestão de horários (padrão).
     - **`➕ Carga Suplementar`**: permanece vinculada ao docente para diário/chamada/notas, mas é **desconsiderada** na geração da grade regular.
   - Essa classificação pode ser alternada com 1 clique tanto na tela de **Atribuição de Turmas** quanto dentro do próprio assistente (**Quadro de Horários > Sugestão Especialistas**), e salva permanentemente em `diario-classe/professores/{id}/turmasSuplementares`.
   - Caso um especialista possua apenas turmas suplementares no escopo, ele é sinalizado e ignorado no gerador regular.

4. **Limite de 2 Especialistas por Turma no Mesmo Dia**:
   - Nenhuma sala/turma recebe 3 especialistas diferentes no mesmo dia da semana (ex.: uma turma pode ter Arte e Educação Física na segunda-feira, mas Informática não será alocada nesse mesmo dia).

5. **Respeito Integral à Folga Semanal (Dia Todo)**:
   - Antes de gerar a proposta, a coordenação seleciona o **dia de folga** de cada especialista (Segunda a Sexta ou sem folga fixa), bloqueando o dia inteiro.
   - O algoritmo garante **0 aulas** no dia de folga do docente, aproveitando esse dia para encaixar os demais especialistas nas turmas.

6. **Separação por Turno, Horário do Sino Configurável e Deslocamento entre Escolas (`3 aulas - intervalo - 2 aulas`)**:
   - Os turnos **Matutino**, **Vespertino** e **Noturno** utilizam os perfis flexíveis de aulas e intervalos configurados em **`⏰ Horário do Sino`** (padrão da rede ou horário próprio por escola em `diario-classe/config/sino`), com vínculo automático por série, ajuste manual por turma e variação opcional por dia da semana (`intervaloGrupoPorDia`).
   - Quando um especialista divide o mesmo turno entre duas escolas da rede (ex.: 3 aulas antes do recreio na Escola A e 2 aulas após o recreio na Escola B), a opção **Outras Escolas no Turno** bloqueia choques com aulas já oficializadas nas outras escolas e exige **pelo menos 15 minutos de intervalo** para troca de unidade no mesmo dia (permitindo a transição natural no recreio de 20+ min, mas evitando aulas coladas com 0 min entre escolas diferentes).

---

## ⚙️ Parâmetros do Gerador

| Parâmetro | Opções | Recomendação |
|---|---|---|
| **Turno de Planejamento** | **Todos os Turnos**, **Manhã**, **Tarde** ou **Noite** | Escolha um turno específico para montar por período, ou **Todos** para a escola inteira |
| **Aulas por Turma na Semana** | `1`, `2` (padrão) ou `3` aulas | `2 aulas por semana` |
| **Formato das Aulas** | **Misto Inteligente**, **Bloco Dobrado Estrito** ou **Dias Separados** | **Misto Inteligente**: prioriza blocos dobrados (`1ª-2ª` ou `4ª-5ª` aula sem cruzar o recreio) e só divide em dias separados se o limite de blocos do turno for excedido |
| **Outras Escolas no Turno** | Checkbox *"Bloquear choques com aulas já oficializadas em outras escolas e exigir intervalo (≥ 15 min) para deslocamento"* | Manter **marcado** quando o especialista atende duas escolas no mesmo turno |
| **Grade Existente da Turma** | Checkbox *"Evitar horários já ocupados por regentes no quadro atual"* | Deixar **desmarcado** ao planejar uma proposta do zero para o próximo ano |

---

## 🚦 Execução, Cancelamento e Diagnóstico

- **Execução Cooperativa**: O cálculo utiliza heurística gulosa multi-tentativa (resolve cenários padrão em poucos milissegundos) seguida de backtracking cooperativo limitado (máximo `12.000` passos / `2,5 segundos`), mantendo a interface fluida.
- **Cancelamento Imediato**: Durante o processamento, uma barra de progresso exibe o andamento e disponibiliza o botão **Cancelar** para interromper a operação a qualquer momento.
- **Cenários Parciais**: Se uma restrição tornar 100% do encaixe matematicamente inviável (por exemplo, mais de 8 turmas no mesmo turno em modo *Bloco Dobrado Estrito* com 1 dia de folga, ou horários já ocupados em outra escola), o sistema retorna o melhor encaixe possível e exibe exatamente quais turmas/especialistas ficaram pendentes e o motivo.

---

## 🖱️ Ajuste Fino, Troca Cruzada entre Turmas & Área de Swap

Após gerar a sugestão, a coordenação pode ajustar manualmente qualquer aula de especialista **arrastando e soltando** o cartão (`⋮⋮`) diretamente na grade (ou usando o botão **Mover** por clique para telas sensíveis ao toque), tanto na aba **Por Turma** quanto na aba **Por Especialista**:

- **Sinalização Visual Imediata ao Arrastar**:
  - **Verde (`✓ Soltar aqui`)**: horário livre para o docente e para a turma sem qualquer choque.
  - **Azul (`⇄ Permutar` ou `⇄ Trocar 4º A`)**:
    - *Permuta na mesma turma*: troca dois especialistas dentro da mesma sala quando nenhum conflita no horário inverso.
    - *Troca Cruzada entre Turmas (aba Por Especialista)*: permite arrastar diretamente a turma A de um dia/horário (ex.: `1º A` na terça) sobre a turma B em outro dia/horário do mesmo especialista (ex.: `4º A` na segunda), invertendo ambas as turmas caso os dois horários estejam compatíveis e sem conflitos.
  - **Vermelho (`✕ Conflito` / `✕ Bloqueado`)**: movimento bloqueado com exibição instantânea do motivo exato no painel superior e ao passar o mouse:
    1. **Folga semanal** do especialista envolvido (inclusive tentando soltar em coluna `Folga Livre`).
    2. **Choque de horário em outra turma** da escola (usando os horários reais de sino da escola selecionada).
    3. **Choque ou falta de intervalo (≥ 15 min)** com aula oficializada em **outra escola**.
    4. **Limite de 2 especialistas/dia** na mesma turma.
    5. **Bloqueio Estrito Entre Turnos**: não é permitido movimentar ou permutar uma aula de um turno para outro (ex.: Manhã para Tarde). Tabelas de outros turnos ficam visualmente travadas durante o arraste (`🔒 Turno bloqueado`).
- **Área de Swap (Bandeja Temporária — Empilhar e Desempilhar em Grade Cheia)**:
  - Quando a grade está 100% preenchida e é necessário liberar um espaço para fazer remanejamentos em cadeia entre dias ou especialistas diferentes, **arraste qualquer cartão de aula (`⋮⋮`) diretamente para a Área de Swap** (ou clique no botão **`📥 Swap`** do próprio cartão) para estacioná-la.
  - A aula estacionada libera imediatamente seu horário original na turma e no docente. Você pode navegar livremente entre **Por Turma** e **Por Especialista**, selecionar outro docente, clicar no cartão da Bandeja (ou arrastá-lo) e **reencaixá-lo** em um horário verde (livre) ou azul (`⇄ Trocar p/ Swap` — coloca a aula estacionada no lugar e envia a aula ocupante para a Área de Swap).
  - Botões de atalho na própria Bandeja permitem saltar direto para a **🏫 Turma**, para o **🎨 Especialista** ou tentar **↩️ Devolver à Origem**.
  - O botão **Aprovar & Gravar no Quadro Oficial** exige que a Área de Swap esteja vazia antes de gravar definitivamente no banco.
- **Histórico Seguro**: os botões **Desfazer** e **Restaurar Original** revertem movimentações e operações na Área de Swap antes de exportar ou gravar no quadro oficial.
- **Aulas Externas Somente Leitura**: cartões marcados como `🏫 Escola ... • Oficial` na visão do especialista servem de referência visual e não podem ser arrastados a partir de outra escola.

---

## ⭐ Inserção de Hora-Atividade (H.A.) dos Especialistas nas Lacunas

Na aba **Por Especialista**, após revisar e ajustar as aulas da escola, a coordenação pode fechar o quadro completo inserindo as **H.A.** diretamente nas lacunas livres do docente:

- **Marcação com 1 Clique nas Lacunas (`-`)**: passe o mouse sobre qualquer horário vago (que não seja **Folga Livre**, aula sugerida ou aula oficial em outra escola) e clique em **`+ H.A.`** para marcar **`⭐ H.A. Planejamento`**. Um novo clique remove a H.A.
- **Contador em Tempo Real**: o cabeçalho do especialista exibe `⭐ H.A.: X / Meta` (comparando com a meta semanal `metaHA` do professor, quando configurada) além do botão rápido **Limpar H.A.**.
- **Proteção Automática Contra Sobreposição**:
  - Não é possível marcar H.A. no dia de folga semanal nem sobre horários ocupados.
  - Se o coordenador arrastar ou encaixar do Swap uma aula para uma lacuna que já tinha H.A., a H.A. conflitante daquele horário é removida automaticamente.
- **Integração com o Quadro Oficial e H.A. do Regente**: ao clicar em **"Confirmar e Gravar no Quadro Oficial da Escola"**, além das grades das turmas selecionadas (`turmas/{id}/gradeHoraria`), as H.A. dos especialistas são gravadas tanto em `diario-classe/professores/{id}/haHorariosFixos` quanto em `diario-classe/config/horaAtividade/{id}`, ficando imediatamente visíveis na **Agenda** e no **Saldo de H.A.** do Quadro de Horários. Simultaneamente, cada aula de especialista oficializada assegura a **H.A. natural** do(a) professor(a) regente da turma (definido na turma ou identificado automaticamente pelas atribuições, ignorando cadastros exclusivos de biblioteca/`Gestão da Biblioteca`, desde que sem choque com outra sala no mesmo horário).

---

## 📊 Visualização, Exportação e Aprovação

Após gerar, ajustar aulas e preencher as H.A. nas lacunas, a coordenação dispõe de 3 abas de conferência:
1. **Por Turma**: grade semanal da sala selecionada (agrupada por turno no seletor), com horários de sino configurados para a escola, faixa de **Intervalo**, selo diário de conformidade (`Seg: 2 esp ✅`), arrastar/soltar, permutar e envio para a **Área de Swap (`📥`)**.
2. **Por Especialista**: grades semanais **separadas por turno** (`☀️ Manhã`, `🌤️ Tarde`, `🌙 Noite`), exibidas juntas de forma compacta na **mesma folha** (com filtro rápido `Todos na mesma folha` ou turno isolado), faixas de intervalo dinâmicas da escola, aulas já oficializadas em outras escolas sinalizadas, destaque visual para a **Folga Livre**, bloqueio de troca entre turnos ao arrastar, **troca cruzada entre turmas**, envio para a **Área de Swap (`📥`)** e inserção direta de **⭐ H.A.** nas lacunas livres.
3. **Aplicar ao Quadro Oficial**: resumo unificado com checklist das turmas aprovadas (exibindo quantas **H.A. p/ Regente** cada turma garante e o regente vinculado) e conferência das **H.A. configuradas por especialista** antes da gravação definitiva no Firebase Realtime Database.

Também estão disponíveis opções completas de **exportação e impressão espelhando a tela "Por Especialista"** (para entrega individual a cada docente):

- **Exportar Excel (`.xlsx`)**:
  - A primeira parte da planilha gera **uma aba individual exclusiva para cada especialista**, reproduzindo exatamente o formato da aba *Por Especialista* (cabeçalho com Escola, Ano Letivo, **versão/data do rascunho**, Especialista, Disciplina, Folga, H.A. e Aulas na Escola; quadros separados por turno `☀️ Manhã`, `🌤️ Tarde`, `🌙 Noite`; faixas de `☕ Intervalo`; colunas de `Segunda` a `Sexta`; aulas de outras escolas já oficializadas; coluna de `☕ Folga Livre`; e marcações de `⭐ H.A. Planejamento`), configurada em **paisagem (1 página)** pronta para impressão.
  - Ao final do mesmo arquivo seguem as abas administrativas *Quadro por Turma* e *Conformidade das Regras* (registrando a versão de referência exportada, com sufixo `-vN` no nome do arquivo quando houver versão salva).
- **PDF Individuais**: gera arquivo PDF em formato A4 paisagem onde **cada especialista recebe sua(s) própria(s) página(s) individual(is)** no mesmo layout da tela *Por Especialista*, incluindo identificação da versão/data no cabeçalho e rodapé e espaço para **ciência/assinatura do(a) docente**.
- **Imprimir Individuais / Imprimir Turma**:
  - Na aba *Por Especialista* ou *Aplicar ao Quadro Oficial*, o botão **Imprimir Individuais** imprime todos os especialistas da escola em sequência com **1 folha por especialista** (quebra de página automática e ocultação de painéis de configuração), imprimindo também a versão e data/hora de referência no rodapé.
  - Na aba *Por Turma*, **Imprimir Turma** imprime apenas o quadro semanal da turma selecionada com identificação da versão/data no cabeçalho.
- **Atalho por Docente (`Este docente: PDF | Excel | Imprimir`)**: dentro da aba *Por Especialista*, permite gerar imediatamente o PDF, o Excel (aba única) ou a impressão isolada **apenas do especialista selecionado no momento**.

---

## ☁️ Histórico de Versões de Rascunho & Restauração Multi-Dispositivo (Nuvem & Código Base62)

Para evitar ter que refazer toda a simulação quando for preciso interromper o trabalho, comparar propostas ou concluí-lo em outro computador (sem depender do navegador local):

- **Múltiplas Versões na Nuvem (`v1`, `v2`, `v3`...)**:
  - Cada salvamento grava uma versão independente em `diario-classe/config/simulacoesHorarios` (com número sequencial `vN`, rótulo opcional personalizável, origem da gravação, data/hora exata `salvoEm`, autor `salvoPor` e resumo de aulas, **⭐ H.A.** e **Área de Swap**), preservando versões anteriores sem sobrescrevê-las (mantendo total compatibilidade com rascunhos legados).
  - No painel de histórico da escola é possível **Restaurar**, **Renomear** o rótulo, **Ver/Copiar Código Base62** ou **Excluir** versões específicas, além de visualizar o selo **`● Em uso`** indicando qual versão corresponde à tela atual.
  - Ao salvar manualmente sobre uma versão carregada que foi modificada, o administrador pode escolher entre **Salvar Nova Versão (`vN`)** ou **Atualizar Versão Anterior**.
- **Detecção Inteligente de Alterações (`assinaturaConteudo`)**:
  - O sistema gera uma assinatura determinística do conteúdo da simulação (grades, H.A., folgas, opções, turmas selecionadas e Área de Swap) para comparar com as versões salvas na nuvem.
  - Na barra de ações, um selo informa em tempo real se a tela está sincronizada (**`Versão vX • data/hora`**) ou se há **`Alterações não salvas`**.
  - **Sem duplicação desnecessária**: se nenhuma alteração tiver sido feita desde uma versão já salva na nuvem, clicar em **Salvar**, **Exportar Excel**, **PDF Individuais**, **Imprimir** ou **Código Base62** **não solicita novo salvamento**.
- **Confirmação Obrigatória Antes de Salvar (Exportar, Imprimir e Importar)**:
  - **Ao Exportar Excel, Gerar PDF, Imprimir ou Exportar Código Base62** (para administradores, quando houver alterações não salvas): o sistema solicita confirmação antes de prosseguir, permitindo escolher entre **Salvar `vN` e Continuar** (com rótulo opcional), **Continuar sem Salvar** ou **Cancelar**.
  - **Ao Importar via Código Base62 (`DC1...` / `.hor.txt`)**: se a simulação restaurada diferir das versões salvas na nuvem para o mesmo escopo, após a conferência automática contra o banco atual o sistema exibe o resumo (e eventuais conflitos) e pergunta ao administrador se deseja **Salvar Nova Versão (`vN`)** ou **Não Salvar Agora**.
- **Código Portátil Base62 (`DC1...`)**: o botão **Código Base62** gera um texto compacto apenas com letras e números (`0–9`, `A–Z`, `a–z`), que pode ser copiado ou baixado em arquivo `.hor.txt` (com sufixo `-vN` quando aplicável) para restaurar posteriormente via **Restaurar via Código Base62**.
- **Revalidação Automática Contra o Banco Atual**: ao restaurar uma versão da nuvem ou um Código Base62, o sistema confere automaticamente todas as aulas contra:
  1. **Novos horários oficializados em outras escolas** desde que o rascunho foi salvo (sinalizando choques ou falta de intervalo ≥ 15 min).
  2. **Alterações de atribuições ou Carga Suplementar** (alertando docentes desvinculados ou novas turmas sem horário no rascunho).
  3. **Modificações posteriores no quadro oficial da turma**, garantindo revisão segura antes de clicar em *"Aprovar & Gravar no Quadro Oficial"*.

---

## 🔒 Regras de Segurança do Firebase (`database.rules.json`)

- **Nenhuma alteração nas regras de segurança é necessária** para este módulo, para o **Horário do Sino** ou para as **Horas-Atividade (H.A.)**:
  - A gravação da grade aprovada utiliza `diario-classe/turmas/{turmaId}/gradeHoraria`, já protegida para administradores.
  - A classificação de turmas suplementares (`turmasSuplementares`) e `haHorariosFixos` utilizam `diario-classe/professores/{uid}`, já coberto pela permissão de escrita de administradores em `professores/$uid`.
  - Os rascunhos multi-dispositivo (`diario-classe/config/simulacoesHorarios`), os horários configuráveis do sino (`diario-classe/config/sino`) e os blocos estruturados de Hora-Atividade (`diario-classe/config/horaAtividade`) ficam todos sob **`diario-classe/config`**, já protegido pelas regras existentes (leitura para equipe autorizada e escrita exclusiva para administradores).
