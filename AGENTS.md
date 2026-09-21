# Diretrizes do Projeto - Diário de Classe

## Regras Obrigatórias em Toda Implementação

1. **Atualização Automática dos Pacotes de Distribuição**:
   - Sempre que uma implementação for concluída ou modificada no código, executar `npm run pack` para atualizar:
     - O arquivo ZIP completo do projeto (`public/diario-de-classe-projeto.zip`).
     - O arquivo HTML único autônomo (`public/app-unico.html` e `public/diario-de-classe.html`).

2. **Sinalização de Alterações em Regras de Segurança**:
   - Sempre que houver qualquer alteração ou adição nas regras de segurança do banco de dados (`database.rules.json` ou `firestore.rules`), sinalizar explicitamente ao usuário para que ele possa atualizar as regras no console do Firebase.

3. **Integridade Referencial e Controle de Acesso**:
   - Manter as validações de integridade referencial antes de qualquer exclusão (professores com turmas, alunos com notas/faltas, turmas com alunos/dados, escolas com turmas, disciplinas com planos).
   - Respeitar a segregação de permissões entre Administrador e Professor comum.
