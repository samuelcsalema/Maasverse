# Maasverse Codex

Aplicação estática em HTML, CSS e JavaScript puro, pronta para publicar no GitHub Pages. Não há backend nem etapa de build.

## O que inclui

- Biblioteca com as 16 obras dos JSONs enviados, capas locais em `assets/covers/`, progresso por porcentagem ou páginas e avaliação de 1 a 5 estrelas.
- Perfis de personagens, magias/poderes e artefatos agrupados entre os livros quando a base identifica a mesma entidade. Os filtros permitem escolher a saga e, opcionalmente, um livro específico.
- Revelações progressivas: a ficha mostra a descrição mais recente compatível com o progresso registrado e libera detalhes à medida que os pontos de leitura são alcançados. É possível selecionar **Mostrar tudo (spoilers)** para ignorar o bloqueio.
- Linha do tempo integrada com eventos das três sagas, feedback pessoal por evento e vínculos com personagens/elementos que reaparecem em outros livros. Os filtros de saga e livro são opcionais; por padrão, o fluxo reúne todos os eventos.
- Comentários pessoais de lore, pesquisa geral, conexões entre entidades e exportação/importação de backup.
- Persistência em `localStorage`. Ao abrir esta versão pela primeira vez, o código tenta migrar os dados do projeto anterior para os novos IDs de livro sem perder progresso e comentários quando a correspondência é identificável.

## Publicar no GitHub Pages

1. Extraia o ZIP e envie **o conteúdo** da pasta `maasverse-codex` para a raiz do repositório (ou mantenha os arquivos numa pasta e aponte o Pages para ela).
2. No GitHub, abra **Settings → Pages**.
3. Escolha a branch principal e a pasta `/ (root)` e salve.
4. Abra o endereço de Pages publicado. Os arquivos de capa estão dentro de `assets/covers/`; não os remova nem mude seus caminhos sem atualizar o código.

## Dados, cronologia e spoilers

Os JSONs originais estão embutidos em `data.js`; as imagens estão em `assets/covers/`. As revelações são normalizadas a partir de campos como `revelations`, `knowledge_stages`, `reveal_stages` e `reveal_points`, que variam entre os arquivos.

A linha do tempo apresenta os eventos de todas as sagas em um fluxo. Quando a base traz data canônica, ela é usada; quando não há data comparável entre histórias, a ordenação é aproximada por pistas temporais, volume e posição relativa na narrativa. O código não inventa datas específicas. Por isso, a linha do tempo deve ser tratada como uma consolidação da base disponível, não como uma cronologia canônica editorialmente confirmada.

Para seu backup, use **Exportar backup** periodicamente. Importar um backup substitui os dados pessoais locais. Limpar os dados do navegador pode apagar notas e progresso. As fontes Google Fonts e Font Awesome usam CDN; capas, JSONs, CSS e JavaScript são locais.


## Resumos gerais

A seção **Resumos gerais** reúne os quatro documentos enviados na versão estendida: resumos das sagas e livros, personagens e eventos, crossover Maasverse, e mundos/magia/espécies. O conteúdo publicado fica empacotado em `summaries.js`; não é necessário instalar dependências ou configurar um backend.

## Ajustes de navegação mobile

- Deslize da borda esquerda para a direita por pelo menos **50 px** para abrir o menu lateral.
- Com o menu aberto, deslize para a esquerda para fechá-lo; tocar fora do menu também o fecha.
- O menu lateral pode ser rolado em celulares menores para acessar Exportar backup e Importar backup.
- O botão **Importar backup** também fica no cabeçalho mobile, ao lado do título da área atual.
- Os campos de pesquisa e filtros foram ajustados para telas estreitas, incluindo tabelas e documentos da área Resumos gerais.

Link: https://samuelcsalema.github.io/Maasverse/
