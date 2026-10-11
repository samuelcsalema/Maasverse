(()=>{
  'use strict';
  const sourceFiles = window.MAASVERSE_SOURCE_FILES || {};
  const summaryDocs = window.MAASVERSE_SUMMARIES || [];
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const STORAGE_KEY = 'maasverse-codex-v1';
  const SERIES_ORDER = [
    'Corte de Espinhos e Rosas (ACOTAR)',
    'Cidade da Lua Crescente',
    'Trono de Vidro'
  ];
  const LORE_FIELDS = {
    characters: ['characters', 'character'],
    magic: ['magic_system', 'magic', 'magics', 'powers'],
    artifacts: ['artifacts', 'items'],
    locations: ['locations'],
    factions: ['factions', 'groups']
  };
  const LORE_LABELS = {
    characters: 'Personagens', magic: 'Magias & poderes', artifacts: 'Artefatos',
    locations: 'Locais', factions: 'Facções'
  };
  let user = { progress: {}, timeline_feedbacks: {}, user_comments: {} };
  try { Object.assign(user, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}); } catch {}
  user.progress ||= {};
  user.timeline_feedbacks ||= {};
  user.user_comments ||= {};

  const books = [];
  const records = { characters: [], magic: [], artifacts: [], locations: [], factions: [] };
  const profiles = { characters: [], magic: [], artifacts: [], locations: [], factions: [] };
  const events = [];
  const bookById = new Map();
  const booksBySourceId = new Map();
  const profilesByLegacyId = new Map();
  const profilesByName = new Map();
  let didMigrate = false;
  let activeSummaryId = summaryDocs[0]?.id || '';

  const asArray = value => Array.isArray(value) ? value : [];
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const str = (obj, keys, fallback = '') => {
    for (const key of keys) {
      const value = obj?.[key];
      if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value);
    }
    return fallback;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const slug = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cleanName = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const unique = array => [...new Set(array.filter(Boolean))];
  function toast(message) {
    const node = document.createElement('div');
    node.className = 'toast'; node.textContent = message; $('#toasts').append(node);
    setTimeout(() => node.remove(), 3200);
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(user)); }
  function canonicalSeries(path, sourceBook) {
    if (/\/ACOTAR\//i.test(path)) return SERIES_ORDER[0];
    if (/Cidade da Lua Crescente/i.test(path)) return SERIES_ORDER[1];
    if (/Trono de Vidro/i.test(path)) return SERIES_ORDER[2];
    const original = str(sourceBook, ['series'], 'Outros');
    return original === 'Corte de Espinhos e Rosas' ? SERIES_ORDER[0] : original;
  }
  function titleFromPath(path) {
    let base = path.split('/').pop().replace(/\.json$/i, '').replace(/_\d+$/, '').replaceAll('_', ' ');
    return base.replace(/\b\w/g, char => char.toUpperCase()).replace(/\bDa\b/g, 'da').replace(/\bDe\b/g, 'de').replace(/\bDo\b/g, 'do').replace(/\bE\b/g, 'e');
  }
  function chapterCountOf(sourceBook, root) {
    const b = object(sourceBook);
    const values = [
      b.source_metadata?.chapter_count_in_toc, b.source_metadata?.chapter_count,
      b.reading_structure?.units_total, b.source_structure?.narrative_chapters,
      b.user_data?.total_chapters, b.user_data?.total_reading_units,
      b.chapter_count, b.total_chapters, b.total_numbered_chapters,
      root.reader_progression?.total_chapters, root.reader_progression?.total_reading_units
    ];
    const found = values.find(value => Number.isFinite(+value) && +value > 0);
    return found ? +found : 0;
  }
  function sequenceOf(sourceBook, path) {
    const book = object(sourceBook);
    const explicit = book.series_volume ?? book.series_position ?? book.volume ?? book.volume_number;
    if (Number.isFinite(+explicit)) return +explicit;
    const match = path.match(/_(\d+)\.json$/i);
    return match ? +match[1] : 999;
  }
  function loadBooksAndEntries() {
    for (const [path, source] of Object.entries(sourceFiles)) {
      if (!source || typeof source !== 'object') continue;
      const root = source;
      const sourceBook = asArray(root.books)[0] || root.book || {};
      const sourceMeta = root.source || root.source_info || root.metadata || root.extraction_metadata || {};
      const title = str(sourceBook, ['title', 'full_title', 'name'], str(sourceMeta, ['source_title', 'title'], titleFromPath(path)));
      const id = slug(path.split('/').slice(-2).join('-').replace(/\.json$/i, '')) || slug(title);
      const legacyId = str(sourceBook, ['id'], str(root.book, ['id'], ''));
      const series = canonicalSeries(path, sourceBook);
      const book = {
        id, legacyId, title, series,
        author: str(sourceBook, ['author'], str(sourceMeta, ['author'], 'Sarah J. Maas')),
        chapterCount: chapterCountOf(sourceBook, root),
        seriesVolume: sequenceOf(sourceBook, path),
        sourcePath: path, raw: root,
        cover: `assets/covers/${slug(title)}.webp`
      };
      books.push(book);
      bookById.set(book.id, book);
      if (legacyId) {
        const list = booksBySourceId.get(legacyId) || [];
        list.push(book); booksBySourceId.set(legacyId, list);
      }

      const lore = object(root.lore);
      for (const [type, keys] of Object.entries(LORE_FIELDS)) {
        for (const key of keys) {
          for (const [index, entry] of asArray(lore[key]).entries()) {
            const raw = object(entry);
            const rawId = str(raw, ['id', 'entity_id', 'character_id', 'artifact_id'], `${type}-${index}`);
            records[type].push({
              type, rawId, legacyId: rawId, stableKey: `${book.id}-${slug(rawId || str(raw, ['name', 'title'], index))}`,
              name: str(raw, ['name', 'title', 'label', 'term'], 'Sem nome'),
              description: str(raw, ['description', 'summary', 'overview', 'details', 'definition', 'content', 'notes'], 'Sem descrição disponível.'),
              book, raw, firstPercent: firstAppearancePercent(raw, book), aliases: aliasesOf(raw)
            });
          }
        }
      }

      let sourceEvents = asArray(root.timeline_events);
      if (!sourceEvents.length && Array.isArray(root.timeline)) sourceEvents = root.timeline;
      if (!sourceEvents.length && root.timeline && Array.isArray(root.timeline.events)) sourceEvents = root.timeline.events;
      if (!sourceEvents.length) sourceEvents = asArray(lore.timeline);
      if (!sourceEvents.length) sourceEvents = asArray(lore.events);
      sourceEvents.forEach((entry, index) => {
        const raw = object(entry);
        const legacyEventId = str(raw, ['id'], `event-${index}`);
        const unlock = object(raw.unlock_at || raw.unlock || raw.reveal_at || raw.source_location);
        const chapter = numericFrom([
          unlock.chapter, unlock.chapter_unlock, unlock.chapter_start,
          raw.chapter, raw.chapter_unlock, raw.first_relevant_chapter, raw.ch, raw.sequence_chapter
        ]);
        const pct = numericFrom([
          unlock.progress_percentage, unlock.progress_percentage_approx,
          unlock.progress_percentage_by_chapter, unlock.percentage,
          raw.progress_percentage, raw.progress_percentage_approx,
          raw.first_reveal_progress_percentage
        ]);
        const relative = str(raw, ['in_world_date', 'calendar_date', 'event_date', 'relative_time', 'relative_date', 'relative_time_marker', 'relative', 'time_marker', 'date_label']);
        const explicitDate = str(raw, ['in_world_date', 'calendar_date', 'event_date']);
        const relatedIds = unique([
          ...asArray(raw.character_ids), ...asArray(raw.related_character_ids), ...asArray(raw.related_characters).map(x => typeof x === 'string' ? x : x?.id),
          ...asArray(raw.artifact_ids), ...asArray(raw.related_artifact_ids),
          ...asArray(raw.location_ids), ...asArray(raw.related_location_ids),
          ...asArray(raw.faction_ids), ...asArray(raw.related_faction_ids),
          ...asArray(raw.relationship_ids), raw.character_id, raw.artifact_id, raw.location_id, raw.faction_id
        ].filter(x => typeof x === 'string'));
        const relatedBookIds = unique([...asArray(raw.related_book_ids), raw.book_id, unlock.book_id].filter(x => typeof x === 'string'));
        events.push({
          id: `${book.id}-${slug(legacyEventId) || `event-${index}`}`, legacyId: legacyEventId,
          title: str(raw, ['title', 'name', 'label'], 'Evento sem título'),
          description: str(raw, ['description', 'summary', 'details', 'content']),
          book, raw, unlock, chapter, percentage: pct, relative, explicitDate,
          localOrder: numericFrom([raw.chronology_index, raw.chronology_order, raw.sequence_order, raw.sequence, raw.order]) ?? index + 1,
          relatedIds, relatedBookIds,
          sourceSection: str(unlock, ['section', 'source_anchor', 'label'], str(raw, ['section', 'relative_time', 'relative_date']))
        });
      });
    }
    books.sort((a, b) => seriesOrder(a.series) - seriesOrder(b.series) || a.seriesVolume - b.seriesVolume || a.title.localeCompare(b.title, 'pt-BR'));
    books.forEach((book, index) => { book.orderIndex = index; });
    migrateLegacyProgress();
  }
  function numericFrom(values) {
    for (const value of values) if (value !== undefined && value !== null && value !== '' && Number.isFinite(+value)) return +value;
    return null;
  }
  function seriesOrder(series) { const n = SERIES_ORDER.indexOf(series); return n < 0 ? SERIES_ORDER.length : n; }
  function aliasesOf(raw) {
    const values = [];
    for (const key of ['aliases', 'also_known_as', 'also_known_as_names', 'alternate_names', 'alternative_names', 'name_variants', 'aka']) {
      const val = raw[key];
      if (Array.isArray(val)) values.push(...val.filter(x => typeof x === 'string'));
      else if (typeof val === 'string' && val.trim()) values.push(...val.split(/[;,]/).map(x => x.trim()));
    }
    return unique(values.filter(Boolean));
  }
  function migrateLegacyProgress() {
    const existing = { ...user.progress };
    for (const book of books) {
      if (!user.progress[book.id] && book.legacyId && existing[book.legacyId]) {
        user.progress[book.id] = { ...existing[book.legacyId] };
        didMigrate = true;
      }
    }
    if (didMigrate) save();
  }
  function percentForDescriptor(descriptor, book, fallback) {
    const d = object(descriptor);
    const directPercent = numericFrom([
      d.progress_percentage, d.progress_percentage_approx, d.progress_percentage_by_chapter,
      d.percentage, d.percent, d.unlock_percentage
    ]);
    if (directPercent !== null) return Math.max(0, Math.min(100, directPercent));
    const chapter = numericFrom([d.chapter, d.chapter_unlock, d.first_relevant_chapter, d.chapter_start, d.chapter_end, d.first_appearance_chapter]);
    if (chapter !== null && book.chapterCount > 0) return Math.max(0, Math.min(100, chapter / book.chapterCount * 100));
    const unit = numericFrom([d.reading_unit_index, d.unit_index, d.reading_position]);
    const total = numericFrom([d.total_reading_units, d.units_total, book.raw?.reader_progression?.total_reading_units, book.chapterCount]);
    if (unit !== null && total > 0) return Math.max(0, Math.min(100, unit / total * 100));
    return fallback;
  }
  function firstAppearancePercent(raw, book) {
    const descriptors = [
      raw.first_appearance, raw.first_reveal, raw.first_known_at, raw.introduced_at,
      raw.first_appearance_position, raw.first_known_position
    ];
    for (const value of descriptors) {
      if (value === undefined || value === null) continue;
      const pct = typeof value === 'number' ? value : percentForDescriptor(value, book, null);
      if (pct !== null && pct !== undefined) return pct;
    }
    const chapter = numericFrom([raw.first_relevant_chapter, raw.first_appearance_chapter, raw.first_revealed_chapter]);
    if (chapter !== null) return percentForDescriptor({ chapter }, book, null);
    const percent = numericFrom([raw.first_reveal_progress_percentage, raw.first_appearance_progress_percentage]);
    if (percent !== null) return Math.max(0, Math.min(100, percent));
    return null;
  }
  function rawStages(record) {
    const result = [];
    const keys = ['revelations', 'knowledge_stages', 'reveal_stages', 'reveal_points', 'revelation_stages', 'progression_stages'];
    const seen = new Set();
    for (const key of keys) {
      for (const [index, item] of asArray(record.raw[key]).entries()) {
        const stage = object(item);
        const descriptor = object(stage.unlock_at || stage.unlock || stage.reveal_at || stage);
        const explicitPercent = percentForDescriptor(descriptor, record.book, null);
        let percent = explicitPercent;
        if (percent === null) percent = 100; // Sem ponto de desbloqueio explícito: somente ao concluir o livro.
        const chapter = numericFrom([descriptor.chapter, descriptor.chapter_unlock, descriptor.first_relevant_chapter, stage.chapter, stage.chapter_unlock]);
        const title = str(stage, ['title', 'name', 'label'], chapter !== null ? `Marco · capítulo ${chapter}` : `Revelação ${index + 1}`);
        const text = str(stage, ['content', 'summary', 'text', 'details', 'detail', 'description', 'reveal'], '');
        if (!text) continue;
        const keySignature = `${Math.round(percent * 100)}|${cleanName(title)}|${cleanName(text)}`;
        if (seen.has(keySignature)) continue;
        seen.add(keySignature);
        result.push({
          id: `${record.stableKey}-stage-${index}`, title, text, percent,
          chapter, sourceSection: str(descriptor, ['section', 'source_anchor', 'label', 'section_unlock'], str(stage, ['section_unlock'])),
          spoiler: str(stage, ['spoiler_level', 'spoiler'], ''),
          revealType: str(stage, ['reveal_type'], ''),
          aliases: unique([...asArray(stage.add_aliases), ...asArray(stage.aliases)].filter(value => typeof value === 'string')),
          book: record.book, sourceRecord: record
        });
      }
    }
    return result.sort((a, b) => a.percent - b.percent || (a.chapter ?? 0) - (b.chapter ?? 0));
  }
  function getProfileKeys(record) {
    // Não agrupamos por qualquer apelido: títulos como “Portadora do Fogo” podem
    // identificar mais de uma pessoa. Apelidos só conectam perfis quando coincidem
    // com o nome real de outra entrada da base.
    return unique([`id:${cleanName(record.rawId)}`, `name:${cleanName(record.name)}`].filter(x => !x.endsWith(':')));
  }
  function buildProfiles() {
    for (const [type, list] of Object.entries(records)) {
      const parent = list.map((_, i) => i);
      const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
      const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
      const owner = new Map();
      list.forEach((record, index) => {
        for (const key of getProfileKeys(record)) {
          if (owner.has(key)) join(index, owner.get(key)); else owner.set(key, index);
        }
      });
      const ownersByRealName = new Map();
      list.forEach((record, index) => {
        const key = cleanName(record.name);
        if (key && !ownersByRealName.has(key)) ownersByRealName.set(key, index);
      });
      list.forEach((record, index) => {
        for (const alias of record.aliases) {
          const normalizedAlias = cleanName(String(alias).replace(/\s*\([^)]*\)/g, ''));
          if (normalizedAlias && ownersByRealName.has(normalizedAlias)) join(index, ownersByRealName.get(normalizedAlias));
        }
      });
      const groups = new Map();
      list.forEach((record, index) => {
        const root = find(index);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(record);
      });
      for (const group of groups.values()) {
        group.sort((a, b) => a.book.orderIndex - b.book.orderIndex || a.name.localeCompare(b.name, 'pt-BR'));
        const minKey = [...group.map(x => x.stableKey)].sort()[0];
        const allNames = unique(group.flatMap(record => [record.name, ...record.aliases]));
        const profile = {
          id: `profile-${type}-${slug(minKey)}`, type, records: group,
          name: group[0].name, aliases: allNames.filter(name => cleanName(name) !== cleanName(group[0].name)),
          series: unique(group.map(record => record.book.series)),
          bookIds: unique(group.map(record => record.book.id)),
          legacyIds: unique(group.map(record => record.legacyId)),
          stages: group.flatMap(record => rawStages(record)),
          relationshipIds: unique(group.flatMap(record => [
            ...asArray(record.raw.relationship_ids), ...asArray(record.raw.related_character_ids),
            ...asArray(record.raw.related_entity_ids), ...asArray(record.raw.related_artifact_ids),
            ...asArray(record.raw.related_location_ids), ...asArray(record.raw.related_faction_ids)
          ].filter(x => typeof x === 'string')))
        };
        profile.stages.sort((a, b) => a.book.orderIndex - b.book.orderIndex || a.percent - b.percent || (a.chapter ?? 0) - (b.chapter ?? 0));
        profiles[type].push(profile);
        for (const legacy of profile.legacyIds) {
          const matched = profilesByLegacyId.get(legacy) || [];
          matched.push(profile); profilesByLegacyId.set(legacy, matched);
        }
        for (const name of [profile.name, ...profile.aliases]) {
          const key = cleanName(name); if (!key) continue;
          const matched = profilesByName.get(key) || [];
          matched.push(profile); profilesByName.set(key, matched);
        }
      }
    }
    for (const [type, list] of Object.entries(profiles)) {
      for (const profile of list) {
        if (!user.user_comments[profile.id]) {
          const migrated = profile.legacyIds.flatMap(id => asArray(user.user_comments[id]));
          if (migrated.length) {
            user.user_comments[profile.id] = uniqueComments(migrated);
            didMigrate = true;
          }
        }
      }
    }
    for (const event of events) {
      const oldFeedback = user.timeline_feedbacks[event.legacyId];
      if (oldFeedback && !user.timeline_feedbacks[event.id]) {
        user.timeline_feedbacks[event.id] = asArray(oldFeedback).map(entry => ({ ...entry, bookId: event.book.id, bookTitle: event.book.title }));
        didMigrate = true;
      }
    }
    if (didMigrate) save();
  }
  function uniqueComments(items) {
    const seen = new Set();
    return items.filter(item => {
      const key = `${item.date || ''}|${item.text || ''}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function progressOf(book) {
    const old = user.progress[book.id] || {};
    const statusValue = old.status || 'unstarted';
    return {
      status: statusValue === 'read' || statusValue === 'done' ? 'completed' : statusValue,
      positionType: old.positionType || 'percent', position: Math.max(0, +old.position || 0),
      pageTotal: old.pageTotal || '', rating: Math.max(0, Math.min(5, +old.rating || 0)), notes: old.notes || ''
    };
  }
  function progressPercent(progress) {
    if (progress.status === 'completed') return 100;
    if (progress.positionType === 'page' && +progress.pageTotal > 0) return Math.max(0, Math.min(100, 100 * progress.position / +progress.pageTotal));
    return Math.max(0, Math.min(100, +progress.position || 0));
  }
  const currentPercent = book => progressPercent(progressOf(book));
  const statusLabel = value => ({ unstarted:'Não iniciado', want:'Quero ler', reading:'Em andamento', completed:'Concluído' }[value] || 'Não iniciado');
  function getProfileView(profile, showAll = false) {
    // A descrição inteira de um volume só entra no resumo após concluir esse volume;
    // os estágios menores continuam aparecendo assim que seu capítulo é alcançado.
    const availableRecords = profile.records.filter(record => showAll || progressOf(record.book).status === 'completed');
    const descriptionRecord = availableRecords.at(-1) || profile.records[0];
    const description = descriptionRecord.description;
    const unlockedStages = profile.stages.filter(stage => showAll || currentPercent(stage.book) >= stage.percent);
    const completedStageCount = unlockedStages.length;
    const total = profile.stages.length;
    const identityStage = unlockedStages.filter(stage => stage.aliases.length && /identity|identidade|name|nome/i.test(stage.revealType)).at(-1);
    const useStageName = identityStage && (showAll || identityStage.book.orderIndex > descriptionRecord.book.orderIndex);
    const currentName = useStageName ? identityStage.aliases.at(-1) : descriptionRecord.name;
    const visibleNames = [
      ...availableRecords.flatMap(record => [record.name, ...record.aliases]),
      ...unlockedStages.flatMap(stage => stage.aliases)
    ];
    const availableAliases = unique(visibleNames).filter(name => cleanName(name) !== cleanName(currentName));
    const sourceBooks = unique(availableRecords.map(record => record.book));
    return { description, descriptionRecord, currentName, availableAliases, sourceBooks, unlockedStages, total, completedStageCount };
  }
  function fillBookSelect(element, includeAll = true) {
    if (!element) return;
    const oldValue = element.value;
    element.innerHTML = `${includeAll ? '<option value="">Todos os livros</option>' : ''}` + books.map(book => `<option value="${esc(book.id)}">${esc(book.title)}</option>`).join('');
    if ([...element.options].some(option => option.value === oldValue)) element.value = oldValue;
  }
  function fillSeriesSelect(element, includeAll = true) {
    if (!element) return;
    const oldValue = element.value;
    const series = unique([...SERIES_ORDER, ...books.map(book => book.series)]);
    element.innerHTML = `${includeAll ? '<option value="">Todas as sagas</option>' : ''}` + series.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    if ([...element.options].some(option => option.value === oldValue)) element.value = oldValue;
  }
  function init() {
    fillSeriesSelect($('#seriesFilter'));
    fillBookSelect($('#timelineBook'));
    fillSeriesSelect($('#timelineSeries'));
    fillBookSelect($('#relationBook'));
    fillSeriesSelect($('#relationSeries'));
    $$('.loreBook').forEach(element => fillBookSelect(element));
    $$('.loreSeries').forEach(element => fillSeriesSelect(element));
  }
  function coverMarkup(book, className) {
    return `<div class="${className}" aria-label="Capa de ${esc(book.title)}"><img src="${esc(book.cover)}" alt="Capa de ${esc(book.title)}" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('cover-fallback');this.parentElement.textContent='${esc(book.title).replace(/'/g, '&#39;')}'"></div>`;
  }
  function readingRow(book) {
    const progress = progressOf(book), percent = progressPercent(progress);
    return `<div class="reading-row">${coverMarkup(book, 'mini-cover')}<div class="reading-info"><b>${esc(book.title)}</b><small>${esc(book.series)} · ${Math.round(percent)}% lido</small><div class="track"><div class="fill" style="width:${percent}%"></div></div></div><button class="small-btn" data-edit="${esc(book.id)}">Atualizar</button></div>`;
  }
  function overview() {
    $('#statBooks').textContent = books.length;
    const progress = books.map(progressOf), ratings = progress.map(p => p.rating).filter(Boolean);
    $('#statReading').textContent = progress.filter(p => p.status === 'reading').length;
    $('#statRating').textContent = ratings.length ? `${(ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1)} ★` : '—';
    $('#bookCount').textContent = `${books.length} livros · ${unique(books.map(book => book.series)).length} sagas`;
    $('#statNotes').textContent = Object.values(user.timeline_feedbacks).reduce((sum, list) => sum + asArray(list).length, 0) + Object.values(user.user_comments).reduce((sum, list) => sum + asArray(list).length, 0);
    const nextBook = books.filter(book => progressOf(book).status === 'reading').sort((a,b) => currentPercent(b) - currentPercent(a))[0]
      || books.find(book => progressOf(book).status === 'want')
      || books.find(book => progressOf(book).status !== 'completed');
    $('#continueReading').innerHTML = nextBook ? readingRow(nextBook) : '<p class="muted">Todos os livros estão marcados como concluídos. Parabéns pela jornada!</p>';
    const notes = [];
    Object.values(user.timeline_feedbacks).flat().forEach(item => notes.push({ title: item.bookTitle || 'Feedback da linha do tempo', text: item.text, date: item.date }));
    Object.values(user.user_comments).flat().forEach(item => notes.push({ title: item.entityName || 'Comentário de lore', text: item.text, date: item.date }));
    notes.sort((a,b) => String(b.date).localeCompare(String(a.date)));
    $('#recentNotes').innerHTML = notes.slice(0,4).map(note => `<div class="note"><b>${esc(note.title)}</b><p>${esc(note.text)}</p><small>${note.date ? new Date(note.date).toLocaleDateString('pt-BR') : ''}</small></div>`).join('') || '<p class="muted">Suas anotações aparecerão aqui.</p>';
    const grouped = new Map();
    books.forEach(book => { if (!grouped.has(book.series)) grouped.set(book.series, []); grouped.get(book.series).push(book); });
    $('#seriesGrid').innerHTML = [...grouped.entries()].map(([series, list]) => `<div class="series-card" data-series="${esc(series)}"><i class="fa-solid fa-sparkles"></i><h4>${esc(series)}</h4><p>${list.length} livros · ${list.filter(book => progressOf(book).status === 'completed').length} concluídos</p></div>`).join('');
  }
  function renderBooks() {
    const query = $('#bookSearch').value.toLowerCase(), series = $('#seriesFilter').value, status = $('#statusFilter').value;
    const list = books.filter(book => (`${book.title} ${book.series}`).toLowerCase().includes(query) && (!series || book.series === series) && (!status || progressOf(book).status === status));
    $('#booksGrid').innerHTML = list.map(book => {
      const progress = progressOf(book), percent = progressPercent(progress);
      return `<article class="book-card"><div class="book-top">${coverMarkup(book, 'large-cover')}<div class="book-head"><h3>${esc(book.title)}</h3><div class="series">${esc(book.series)}</div><div class="meta">${esc(book.author)}${book.chapterCount ? ` · ${book.chapterCount} capítulos` : ''}</div><span class="status">${statusLabel(progress.status)}</span></div></div><div class="book-bottom"><div class="line"><span>Progresso</span><span>${Math.round(percent)}% ${progress.rating ? `· ${'★'.repeat(progress.rating)}` : ''}</span></div><div class="track"><div class="fill" style="width:${percent}%"></div></div><div class="book-actions"><button class="small-btn" data-edit="${esc(book.id)}">Editar progresso</button><button class="small-btn" data-details="${esc(book.id)}">Detalhes</button></div></div></article>`;
    }).join('') || '<p class="muted">Nenhum livro encontrado.</p>';
  }
  function modal(content) { $('#modalContent').innerHTML = content; $('#backdrop').hidden = false; }
  function closeModal() { $('#backdrop').hidden = true; }
  function editProgress(bookId) {
    const book = bookById.get(bookId); if (!book) return;
    const progress = progressOf(book);
    modal(`<h2>${esc(book.title)}</h2><p class="muted">${esc(book.series)}</p><form id="progressForm"><div class="form-grid"><label class="form-field">Status<select name="status"><option value="unstarted">Não iniciado</option><option value="want">Quero ler</option><option value="reading">Em andamento</option><option value="completed">Concluído</option></select></label><label class="form-field">Progresso por<select name="positionType"><option value="percent">Porcentagem</option><option value="page">Página exata</option></select></label><label class="form-field">Posição atual (%) ou página<input name="position" type="number" min="0" value="${esc(progress.position)}" required></label><label class="form-field">Total de páginas (opcional)<input name="pageTotal" type="number" min="1" value="${esc(progress.pageTotal)}"></label><div class="form-field full"><span>Avaliação</span><div class="stars">${[1,2,3,4,5].map(value => `<button type="button" data-star="${value}" class="${value <= progress.rating ? 'on' : ''}">★</button>`).join('')}</div><input type="hidden" name="rating" value="${progress.rating}"></div><label class="form-field full">Nota privada<textarea name="notes">${esc(progress.notes)}</textarea></label></div><div class="form-actions"><button type="button" class="small-btn" data-close>Cancelar</button><button class="primary">Salvar progresso</button></div></form>`);
    const form = $('#progressForm'); form.elements.status.value = progress.status; form.elements.positionType.value = progress.positionType;
    $('.stars').onclick = event => { const button = event.target.closest('[data-star]'); if (!button) return; form.elements.rating.value = button.dataset.star; $$('.stars [data-star]').forEach(star => star.classList.toggle('on', +star.dataset.star <= +button.dataset.star)); };
    form.onsubmit = event => {
      event.preventDefault(); const data = new FormData(form);
      const next = { status: data.get('status'), positionType: data.get('positionType'), position: Math.max(0, +data.get('position') || 0), pageTotal: data.get('pageTotal'), rating: +data.get('rating') || 0, notes: data.get('notes') };
      if (next.positionType === 'percent') next.position = Math.min(100, next.position);
      if (next.status === 'completed') {
        if (next.positionType === 'percent') next.position = 100;
        else if (+next.pageTotal > 0) next.position = +next.pageTotal;
      }
      user.progress[book.id] = next; save(); closeModal(); refresh();
      toast(next.status === 'completed' ? 'Livro concluído: as revelações associadas a este livro foram desbloqueadas.' : 'Progresso salvo localmente.');
    };
  }
  function bookDetails(bookId) {
    const book = bookById.get(bookId); if (!book) return;
    const progress = progressOf(book), percent = progressPercent(progress);
    const entityCount = Object.fromEntries(Object.keys(profiles).map(type => [type, profiles[type].filter(profile => profile.records.some(record => record.book.id === book.id)).length]));
    modal(`<h2>${esc(book.title)}</h2><p class="muted">${esc(book.series)}</p><div class="detail-book">${coverMarkup(book, 'large-cover')}<div><p>Status: <b>${statusLabel(progress.status)}</b><br>Progresso: <b>${Math.round(percent)}%</b><br>Avaliação: <b>${progress.rating ? `${progress.rating}/5 estrelas` : 'Ainda não avaliado'}</b><br>Capítulos identificados na base: <b>${book.chapterCount || 'não informado'}</b></p><button class="primary" data-edit="${esc(book.id)}">Editar progresso</button></div></div><section class="panel"><h3>Entradas de lore associadas</h3><p>${entityCount.characters} personagens · ${entityCount.magic} magias/poderes · ${entityCount.artifacts} artefatos</p><p class="muted">Ao concluir o livro, as revelações progressivas deste volume ficam disponíveis nos perfis ligados a ele.</p></section>`);
  }
  function profileFilter(profile, query, series, bookId) {
    const names = [profile.name, ...profile.aliases, ...profile.records.map(record => record.description)].join(' ').toLowerCase();
    return names.includes(query) && (!series || profile.records.some(record => record.book.series === series)) && (!bookId || profile.records.some(record => record.book.id === bookId));
  }
  function renderLore(view) {
    const type = view === 'characters' ? 'characters' : view === 'magic' ? 'magic' : 'artifacts';
    const query = $(`.loreSearch[data-type="${type}"]`).value.toLowerCase();
    const series = $(`.loreSeries[data-type="${type}"]`).value;
    const bookId = $(`.loreBook[data-type="${type}"]`).value;
    const showAll = $(`.loreSpoilers[data-type="${type}"]`).value === 'all';
    const list = profiles[type].filter(profile => profileFilter(profile, query, series, bookId));
    $(`#${type}Grid`).innerHTML = list.map(profile => {
      const viewData = getProfileView(profile, showAll);
      const progressLabel = profile.stages.length ? `${viewData.completedStageCount}/${viewData.total} revelações` : `${profile.records.length} registro(s) na base`;
      const sources = unique(profile.records.filter(record => !series || record.book.series === series).filter(record => !bookId || record.book.id === bookId).map(record => record.book.title));
      return `<article class="lore-card"><div class="type">${LORE_LABELS[type]}</div><h3>${esc(viewData.currentName)}</h3>${viewData.availableAliases.length ? `<div class="alias-line">Também conhecido(a) como: ${esc(viewData.availableAliases.slice(0,5).join(' · '))}</div>` : ''}<p class="desc">${esc(viewData.description)}</p><div class="lore-tags">${unique(profile.records.filter(record => !series || record.book.series === series).filter(record => !bookId || record.book.id === bookId).map(record => record.book.series)).map(value => `<span class="tag">${esc(value)}</span>`).join('')}<span class="tag progress-tag">${esc(progressLabel)}</span></div><div class="lore-bottom"><small>${asArray(user.user_comments[profile.id]).length} comentário(s) seu(s)<br>${esc(sources.slice(0,2).join(' · '))}${sources.length > 2 ? ` +${sources.length-2}` : ''}</small><button class="small-btn" data-lore="${type}|${esc(profile.id)}">Abrir ficha</button></div></article>`;
    }).join('') || '<p class="muted">Nenhuma entrada encontrada com estes filtros.</p>';
  }
  function getRelations(profile) {
    const found = new Map();
    for (const rawId of profile.relationshipIds) {
      for (const candidateList of [profilesByLegacyId.get(rawId) || []]) for (const candidate of candidateList) if (candidate.id !== profile.id) found.set(candidate.id, candidate);
    }
    return [...found.values()].slice(0, 18);
  }
  function openLore(type, profileId, showAllOverride = false) {
    const profile = (profiles[type] || []).find(item => item.id === profileId); if (!profile) return;
    const showAll = showAllOverride || ($(`.loreSpoilers[data-type="${type}"]`)?.value === 'all');
    const viewData = getProfileView(profile, showAll);
    const comments = asArray(user.user_comments[profile.id]);
    const groupedStages = new Map();
    for (const stage of viewData.unlockedStages) {
      if (!groupedStages.has(stage.book.id)) groupedStages.set(stage.book.id, { book: stage.book, stages: [] });
      groupedStages.get(stage.book.id).stages.push(stage);
    }
    const stagesMarkup = [...groupedStages.values()].map(group => `<div class="revelation-group"><h4>${esc(group.book.title)} <small>${esc(group.book.series)}</small></h4>${group.stages.map(stage => `<article class="revelation"><div class="revelation-head"><b>${esc(stage.title)}</b><span>${Math.round(stage.percent)}%${stage.chapter !== null ? ` · cap. ${stage.chapter}` : ''}</span></div><p>${esc(stage.text)}</p>${stage.spoiler ? `<span class="tag">${esc(stage.spoiler)}</span>` : ''}${stage.revealType ? `<span class="tag">${esc(stage.revealType.replaceAll('_', ' '))}</span>` : ''}</article>`).join('')}</div>`).join('');
    const relations = getRelations(profile);
    const sourceList = unique(profile.records.map(record => record.book)).sort((a,b) => a.orderIndex-b.orderIndex);
    const knownNames = viewData.availableAliases.filter(name => cleanName(name) !== cleanName(viewData.currentName));
    modal(`<div class="profile-title"><p class="eyebrow">${LORE_LABELS[type].toUpperCase()}</p><h2>${esc(viewData.currentName)}</h2>${knownNames.length ? `<p class="muted">Outros nomes já conhecidos: ${esc(knownNames.join(' · '))}</p>` : ''}</div><p>${esc(viewData.description)}</p><div class="profile-meta"><span class="tag">${viewData.completedStageCount}/${viewData.total} revelações desbloqueadas</span><span class="tag">${sourceList.length} livro(s) associado(s)</span></div><section class="panel"><h3>Evolução da história</h3>${stagesMarkup || '<p class="muted">Ainda não há revelações desbloqueadas para este perfil. Atualize seu progresso nos livros associados para fazer a ficha evoluir.</p>'}${!showAll && viewData.completedStageCount < viewData.total ? `<p class="muted locked-note">${viewData.total - viewData.completedStageCount} revelação(ões) ainda oculta(s) até alcançar o ponto de leitura correspondente.</p><button class="small-btn" id="showAllProfile">Mostrar todas as revelações (com spoilers)</button>` : ''}</section><section class="panel"><h3>Presença nos livros</h3><div class="source-book-list">${sourceList.map(book => `<div class="source-book-row">${coverMarkup(book, 'source-mini-cover')}<div><b>${esc(book.title)}</b><small>${esc(book.series)} · ${Math.round(currentPercent(book))}% · ${statusLabel(progressOf(book).status)}</small></div><button class="small-btn" data-edit="${esc(book.id)}">Progresso</button></div>`).join('')}</div></section><section class="panel"><h3>Conexões relacionadas</h3>${relations.length ? `<div class="related-chips">${relations.map(item => `<button class="small-btn" data-lore="${item.type}|${esc(item.id)}">${esc(getProfileView(item, showAll).currentName)}</button>`).join('')}</div>` : '<p class="muted">A base não registra vínculos estruturados adicionais para esta entrada.</p>'}</section><section class="panel"><h3>Suas anotações (${comments.length})</h3>${comments.map(comment => `<div class="note"><p>${esc(comment.text)}</p><small>${comment.date ? new Date(comment.date).toLocaleString('pt-BR') : ''}</small></div>`).join('')}<form id="commentForm"><label class="form-field">Adicionar opinião ou teoria<textarea name="text" required></textarea></label><div class="form-actions"><button class="primary">Salvar comentário</button></div></form></section>`);
    $('#commentForm').onsubmit = event => {
      event.preventDefault(); const text = new FormData(event.currentTarget).get('text').trim(); if (!text) return;
      (user.user_comments[profile.id] ||= []).push({ text, date: new Date().toISOString(), entityName: viewData.currentName, type });
      save(); openLore(type, profile.id, showAll); overview(); toast('Comentário salvo.');
    };
    $('#showAllProfile')?.addEventListener('click', () => openLore(type, profile.id, true));
  }
  function eventProgress(event) {
    if (event.percentage !== null && event.percentage !== undefined) return Math.max(0, Math.min(100, event.percentage));
    if (event.chapter !== null && event.chapter !== undefined && event.book.chapterCount > 0) return Math.max(0, Math.min(100, event.chapter / event.book.chapterCount * 100));
    return null;
  }
  function eventVisible(event, showAll) {
    if (showAll || progressOf(event.book).status === 'completed') return true;
    const threshold = eventProgress(event);
    return threshold !== null && currentPercent(event.book) >= threshold;
  }
  function explicitDateValue(value) {
    if (!value || typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!/^\d{4}([-/.]\d{1,2}){1,2}/.test(normalized)) return null;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function relativeYearOffset(value) {
    const text = cleanName(value);
    const numbers = { um:1, uma:1, dois:2, duas:2, tres:3, quatro:4, cinco:5, seis:6, sete:7, oito:8, nove:9, dez:10, cem:100, mil:1000 };
    const match = text.match(/(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|cem|mil)\s+anos?/);
    if (match && /antes|antigo|antiga|passado|passada|seculos|milenio/.test(text)) {
      const count = /^\d+$/.test(match[1]) ? +match[1] : numbers[match[1]] || null;
      if (count !== null) return -count;
    }
    if (/mil anos|milenio|seculos antes/.test(text)) return -1000;
    if (/antes do inicio|antes da narrativa|antes dos acontecimentos/.test(text)) return -0.5;
    return null;
  }
  function eventSortKey(event) {
    const date = explicitDateValue(event.explicitDate);
    if (date !== null) return [0, date, event.book.orderIndex, event.localOrder];
    const years = relativeYearOffset(event.relative);
    if (years !== null) return [1, years, event.book.orderIndex, event.localOrder];
    const chapter = eventProgress(event) ?? ((event.localOrder / Math.max(1, event.book.chapterCount)) * 100);
    // Intercala volumes de sagas diferentes em um só fluxo, usando o volume e a posição relativa
    // como aproximação quando não existe uma data canônica comparável entre os livros.
    return [2, event.book.seriesVolume, chapter, seriesOrder(event.book.series), event.localOrder];
  }
  function compareKeys(a,b) {
    const ka = eventSortKey(a), kb = eventSortKey(b);
    for (let i=0;i<Math.max(ka.length,kb.length);i++) { const x=ka[i] ?? 0, y=kb[i] ?? 0; if (x<y) return -1; if (x>y) return 1; }
    return 0;
  }
  function relatedProfilesForEvent(event) {
    const found = new Map();
    for (const rawId of event.relatedIds) for (const profile of profilesByLegacyId.get(rawId) || []) found.set(profile.id, profile);
    return [...found.values()].filter(profile => profile.records.some(record => record.book.id === event.book.id) || profile.records.length > 1).slice(0, 8);
  }
  function relatedBooksForProfile(profile, currentBookId) {
    return unique(profile.records.map(record => record.book).filter(book => book.id !== currentBookId)).sort((a,b) => a.orderIndex-b.orderIndex);
  }
  function renderTimeline() {
    const series = $('#timelineSeries').value, bookId = $('#timelineBook').value, showAll = $('#timelineSpoilers').value === 'all';
    const list = events.filter(event => (!series || event.book.series === series) && (!bookId || event.book.id === bookId) && eventVisible(event, showAll)).sort(compareKeys);
    $('#timelineList').innerHTML = `<p class="timeline-explainer">${showAll ? 'Exibição completa: inclui spoilers de todos os volumes.' : 'Linha do tempo integrada: eventos liberados conforme seu progresso em cada livro.'} Datas canônicas são usadas quando a base as informa; quando não há data, a ordem é aproximada com as pistas temporais e a posição do evento na fonte.</p>` + (list.map(event => {
      const label = event.relative || (event.chapter !== null ? `Capítulo ${event.chapter}` : `Ordem local ${event.localOrder}`);
      const linkedProfiles = relatedProfilesForEvent(event);
      const crossBook = new Map();
      linkedProfiles.forEach(profile => relatedBooksForProfile(profile, event.book.id).forEach(book => crossBook.set(book.id, book)));
      event.relatedBookIds.forEach(sourceId => {
        for (const book of booksBySourceId.get(sourceId) || []) if (book.id !== event.book.id) crossBook.set(book.id, book);
      });
      const feedbacks = asArray(user.timeline_feedbacks[event.id]);
      return `<article class="timeline-entry"><div class="event-date">${esc(label)}<small>${esc(event.book.title)}</small></div><div class="axis"><span class="dot"></span></div><div class="event"><div class="event-source"><span class="tag">${esc(event.book.series)}</span>${event.chapter !== null ? `<span class="tag">Cap. ${event.chapter}</span>` : ''}</div><h3>${esc(event.title)}</h3><p>${esc(event.description)}</p>${linkedProfiles.length ? `<div class="event-relations"><small>Personagens e elementos relacionados</small><div class="related-chips">${linkedProfiles.map(profile => `<button class="small-btn" data-lore="${profile.type}|${esc(profile.id)}">${esc(getProfileView(profile, showAll).currentName)}</button>`).join('')}</div></div>` : ''}${crossBook.size ? `<div class="cross-book-links"><small>Conexões em outros livros:</small> ${[...crossBook.values()].slice(0,4).map(book => `<span class="tag">${esc(book.title)}</span>`).join('')}${crossBook.size > 4 ? `<span class="tag">+${crossBook.size-4}</span>` : ''}</div>` : ''}${feedbacks.map(note => `<div class="note"><p>${esc(note.text)}</p><small>${note.date ? new Date(note.date).toLocaleString('pt-BR') : ''}</small></div>`).join('')}<form class="event-form" data-feedback="${esc(event.id)}"><textarea name="text" placeholder="Como você reagiu a este acontecimento?"></textarea><button class="small-btn">Salvar feedback</button></form></div></article>`;
    }).join('') || '<p class="muted">Nenhum evento visível com estes filtros. Avance seu progresso ou escolha “Mostrar tudo (com spoilers)”.</p>');
  }
  function renderRelations() {
    const series = $('#relationSeries').value, bookId = $('#relationBook').value, query = $('#relationSearch').value.toLowerCase();
    $('#relationsGrid').innerHTML = Object.entries(LORE_LABELS).map(([type, label]) => {
      const list = profiles[type].filter(profile => profileFilter(profile, query, series, bookId)).slice(0,40);
      return `<section class="relation-card"><h3>${label} (${list.length})</h3>${list.map(profile => `<div class="relation-item"><b>${esc(getProfileView(profile).currentName)}</b><small>${esc(unique(profile.records.filter(record => !series || record.book.series === series).filter(record => !bookId || record.book.id === bookId).map(record => record.book.title)).slice(0,3).join(' · '))} · ${esc(getProfileView(profile).description.slice(0,130))}</small><button class="small-btn" data-lore="${type}|${esc(profile.id)}">Ficha / comentários / revelações</button></div>`).join('') || '<p class="muted">Nenhuma entrada.</p>'}</section>`;
    }).join('');
  }
  function refresh() {
    overview(); renderBooks();
    const active = $('.view.active')?.id?.replace('view-','');
    if (['characters','magic','artifacts'].includes(active)) renderLore(active);
    if (active === 'timeline') renderTimeline();
    if (active === 'relations') renderRelations();
  }
  function exportBackup() {
    const blob = new Blob([JSON.stringify({ format:'maasverse-codex-backup', version:2, exported_at:new Date().toISOString(), user_data:user }, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `maasverse-backup-${new Date().toISOString().slice(0,10)}.json`; anchor.click(); URL.revokeObjectURL(url); toast('Backup exportado.');
  }
  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text()), saved = data.user_data || data;
      if (!saved.progress) throw new Error('Backup sem progresso');
      if (!confirm('Importar o backup substituirá seus dados pessoais locais. Continuar?')) return;
      const oldProgress = saved.progress || {};
      user.progress = {};
      for (const book of books) {
        const incoming = oldProgress[book.id] || (book.legacyId ? oldProgress[book.legacyId] : null);
        if (incoming) user.progress[book.id] = { ...incoming };
      }
      const oldFeedback = saved.timeline_feedbacks || {};
      user.timeline_feedbacks = {};
      for (const event of events) {
        const incoming = oldFeedback[event.id] || oldFeedback[event.legacyId];
        if (incoming) user.timeline_feedbacks[event.id] = asArray(incoming).map(item => ({ ...item, bookId:event.book.id, bookTitle:event.book.title }));
      }
      const oldComments = saved.user_comments || {};
      user.user_comments = {};
      for (const profile of Object.values(profiles).flat()) {
        const incoming = oldComments[profile.id] || profile.legacyIds.flatMap(id => asArray(oldComments[id]));
        if (asArray(incoming).length) user.user_comments[profile.id] = uniqueComments(asArray(incoming));
      }
      save(); refresh(); toast('Backup importado.');
    } catch { toast('Arquivo de backup inválido.'); }
  }
  function renderSummaries(docId = activeSummaryId) {
    const doc = summaryDocs.find(item => item.id === docId) || summaryDocs[0];
    if (!doc) return;
    activeSummaryId = doc.id;
    $('#summaryDocTitle').textContent = doc.title;
    $('#summaryDocDescription').textContent = doc.description;
    $('#summaryTabs').innerHTML = summaryDocs.map(item => `<button type="button" role="tab" aria-selected="${item.id === doc.id}" class="${item.id === doc.id ? 'active' : ''}" data-summary-doc="${esc(item.id)}">${esc(item.shortTitle)}</button>`).join('');
    $('#summaryIndex').innerHTML = `<p class="eyebrow">NESTE DOCUMENTO</p>` + doc.toc.map(item => `<a class="toc-level-${item.level}" href="#${esc(item.id)}">${esc(item.title)}</a>`).join('');
    $('#summaryContent').innerHTML = doc.html;
  }

  function search(query) {
    const book = books.find(item => cleanName(item.title).includes(cleanName(query)));
    const profile = Object.values(profiles).flat().find(item => cleanName(item.name).includes(cleanName(query)) || item.aliases.some(alias => cleanName(alias).includes(cleanName(query))));
    if (book) { show('books'); $('#bookSearch').value = query; renderBooks(); }
    else if (profile) {
      const view = profile.type === 'characters' ? 'characters' : profile.type === 'magic' ? 'magic' : profile.type === 'artifacts' ? 'artifacts' : 'relations';
      show(view);
      if (['characters','magic','artifacts'].includes(view)) { $(`.loreSearch[data-type="${view}"]`).value = query; renderLore(view); }
      else { $('#relationSearch').value = query; renderRelations(); }
    } else { show('books'); $('#bookSearch').value = query; renderBooks(); }
  }
  function setSidebarOpen(open) {
    const sidebar = $('#sidebar');
    const backdrop = $('#sidebarBackdrop');
    sidebar.classList.toggle('open', open);
    backdrop.hidden = !open;
    backdrop.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('sidebar-open', open);
    $('#menu').setAttribute('aria-expanded', String(open));
    $('#menu').setAttribute('aria-label', open ? 'Fechar menu lateral' : 'Abrir menu lateral');
  }

  function show(view) {
    $$('.view').forEach(element => element.classList.toggle('active', element.id === `view-${view}`));
    $$('nav button[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === view));
    $('#crumb').textContent = ({ overview:'Visão geral', books:'Meus livros', summaries:'Resumos gerais', characters:'Personagens', magic:'Magias & poderes', artifacts:'Artefatos', timeline:'Linha do tempo integrada', relations:'Conexões' })[view] || view;
    setSidebarOpen(false);
    if (view === 'books') renderBooks();
    if (view === 'summaries') renderSummaries();
    if (['characters','magic','artifacts'].includes(view)) renderLore(view);
    if (view === 'timeline') renderTimeline();
    if (view === 'relations') renderRelations();
  }

  loadBooksAndEntries();
  buildProfiles();
  init(); overview(); renderBooks(); renderSummaries();
  $$('nav button[data-view]').forEach(button => button.onclick = () => show(button.dataset.view));
  $$('[data-go]').forEach(button => button.onclick = () => show(button.dataset.go));
  $('#menu').onclick = () => setSidebarOpen(!$('#sidebar').classList.contains('open'));
  $('#sidebarBackdrop').onclick = () => setSidebarOpen(false);

  // Gesto mobile: deslizar 50 px para a direita a partir da borda esquerda abre o menu.
  // Com o menu aberto, deslizar 50 px para a esquerda sobre a área do menu o fecha.
  let swipeStart = null;
  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { swipeStart = null; return; }
    const touch = event.touches[0];
    const open = $('#sidebar').classList.contains('open');
    const fromEdge = touch.clientX <= 28;
    const fromSidebar = open && touch.clientX <= Math.min(window.innerWidth * 0.85, 320);
    swipeStart = (fromEdge || fromSidebar) ? { x: touch.clientX, y: touch.clientY, open } : null;
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (!swipeStart || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - swipeStart.x;
    const dy = touch.clientY - swipeStart.y;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.15) event.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', event => {
    if (!swipeStart || !event.changedTouches.length) { swipeStart = null; return; }
    const touch = event.changedTouches[0];
    const dx = touch.clientX - swipeStart.x;
    const dy = touch.clientY - swipeStart.y;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      if (!swipeStart.open && swipeStart.x <= 28 && dx >= 50) setSidebarOpen(true);
      else if (swipeStart.open && dx <= -50) setSidebarOpen(false);
    }
    swipeStart = null;
  }, { passive: true });
  document.addEventListener('touchcancel', () => { swipeStart = null; }, { passive: true });
  $('#summaryTabs').onclick = event => { const button = event.target.closest('[data-summary-doc]'); if (button) renderSummaries(button.dataset.summaryDoc); };
  $('#globalSearch').onkeydown = event => { if (event.key === 'Enter') search(event.target.value.trim()); };
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); if (event.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#globalSearch').focus(); } });
  $('#bookSearch').oninput = renderBooks; $('#seriesFilter').onchange = renderBooks; $('#statusFilter').onchange = renderBooks;
  $$('.loreSearch').forEach(input => input.oninput = () => renderLore(input.dataset.type));
  $$('.loreBook, .loreSeries, .loreSpoilers').forEach(input => input.onchange = () => renderLore(input.dataset.type));
  $('#timelineSeries').onchange = renderTimeline; $('#timelineBook').onchange = renderTimeline; $('#timelineSpoilers').onchange = renderTimeline;
  $('#relationSeries').onchange = renderRelations; $('#relationBook').onchange = renderRelations; $('#relationSearch').oninput = renderRelations;
  document.body.addEventListener('click', event => {
    const edit = event.target.closest('[data-edit]'), details = event.target.closest('[data-details]'), lore = event.target.closest('[data-lore]'), close = event.target.closest('[data-close]'), series = event.target.closest('[data-series]');
    if (edit) editProgress(edit.dataset.edit);
    if (details) bookDetails(details.dataset.details);
    if (lore) { const separator = lore.dataset.lore.indexOf('|'); openLore(lore.dataset.lore.slice(0, separator), lore.dataset.lore.slice(separator + 1)); }
    if (close) closeModal();
    if (series) { show('books'); $('#seriesFilter').value = series.dataset.series; renderBooks(); }
  });
  $('#closeModal').onclick = closeModal; $('#backdrop').onclick = event => { if (event.target === $('#backdrop')) closeModal(); };
  $('#continueReading').onclick = event => { const button = event.target.closest('[data-edit]'); if (button) editProgress(button.dataset.edit); };
  $('#seriesGrid').onclick = event => { const card = event.target.closest('[data-series]'); if (card) { show('books'); $('#seriesFilter').value = card.dataset.series; renderBooks(); } };
  $('#timelineList').onsubmit = event => {
    const form = event.target.closest('[data-feedback]'); if (!form) return; event.preventDefault();
    const id = form.dataset.feedback, text = form.elements.text.value.trim(), timelineEvent = events.find(item => item.id === id);
    if (!text || !timelineEvent) return;
    (user.timeline_feedbacks[id] ||= []).push({ text, date:new Date().toISOString(), bookId:timelineEvent.book.id, bookTitle:timelineEvent.book.title });
    save(); renderTimeline(); overview(); toast('Feedback salvo.');
  };
  $('#export').onclick = exportBackup; $('#import').onclick = () => $('#backupFile').click();
  $('#quickImport').onclick = () => $('#backupFile').click();
  $('#backupFile').onchange = event => { if (event.target.files[0]) importBackup(event.target.files[0]); event.target.value = ''; };
})();
