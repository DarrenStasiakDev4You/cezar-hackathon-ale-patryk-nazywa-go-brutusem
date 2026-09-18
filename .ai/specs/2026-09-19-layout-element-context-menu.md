# Menu kontekstowe elementów layoutu

## 📋 TLDR

W trybie edycji użytkownik może otworzyć menu kontekstowe na konkretnym elemencie layoutu i wykonać pierwszą operację: \`Delete\` / \`Usuń\`. Menu działa dla pojedynczego widgetu oraz grupy, korzystając z rejestru elementów i stabilnych identyfikatorów wprowadzonych przez discovery (\`feat/editable-layout-elements-discovery\`). Ta faza nie dodaje jeszcze edycji ani przesuwania, ale ustanawia punkt rozszerzenia dla kolejnych akcji oraz potwierdzenia usunięcia grupy.

## 📋 Problem Statement

Discovery opisuje, które widgety i grupy należą do layoutu, ale użytkownik nie ma jeszcze bezpośredniej operacji na wskazanym elemencie. Kliknięcie prawym przyciskiem powinno jednoznacznie wskazać element, którego dotyczy działanie, i nie może uruchamiać biznesowych aktywacji blokowanych przez globalny \`editMode\` guard.

Bez wspólnego menu dla widgetu i grupy przyszłe akcje (\`Edit\`, \`Move\`) powstałyby jako osobne, niespójne mechanizmy. Usuwanie grupy wymaga również jawnego określenia zakresu: sama grupa czy całe jej poddrzewo.

## 📋 Proposed Solution

Dodać klientowy \`LayoutElementContextMenu\` montowany przy właścicielu layoutu, który nasłuchuje \`contextmenu\` wyłącznie na elementach oznaczonych \`data-layout-element="true"\`. Pozycja menu wynika z eventu przeglądarki, a cel jest rozwiązywany przez \`data-layout-id\` i \`LayoutRegistry\`; nie skanujemy dokumentu jako źródła prawdy.

W pierwszym etapie menu zawiera jedną aktywną pozycję:

\`\`\`text
Edit       disabled / reserved for a later phase
Move       disabled / reserved for a later phase
Delete     active
\`\`\`

W UI można pokazać \`Edit\` i \`Move\` jako nieaktywne pozycje, aby ustalić przyszły układ menu, ale zakres implementacji obejmuje tylko \`Delete\`. Jeśli standardowy komponent menu w repozytorium nie wspiera nieaktywnych pozycji bez niepożądanej semantyki, pozycje rezerwowe pozostają poza DOM-em do czasu ich implementacji.

Usunięcie jest przekazywane do właściciela layoutu przez callback/komendę, zamiast mutować rejestr bezpośrednio. Dla widgetu callback otrzymuje jeden \`id\`; dla grupy otrzymuje grupę oraz deterministyczny zakres jej poddrzewa. Właściciel aktualizuje model layoutu, a React odmontowuje elementy i rejestr odzwierciedla ten lifecycle.

## Resolved assumptions (autonomous defaults)

| Pytanie | Przyjęta decyzja | Uzasadnienie |
| --- | --- | --- |
| Q1. Czy usunięcie grupy obejmuje dzieci? | Tak: grupa jest usuwana razem z całym poddrzewem. | To najbardziej przewidywalna semantyka dla drzewa; pozwala uniknąć osieroconych widgetów i używa istniejącego \`getSubtree\`. |
| Q2. Czy pierwsza wersja pokazuje potwierdzenie? | Nie: akcja jest przygotowana pod politykę potwierdzenia, ale bez dialogu w pierwszej wersji. | Brief wymaga przewidzenia późniejszego potwierdzenia, a odłożenie dialogu ogranicza zakres i nie blokuje kontraktu callbacku. |
| Q3. Co dzieje się poza \`editMode\` albo poza zarejestrowanym layoutem? | Menu nie otwiera się i event zachowuje standardową semantykę przeglądarki. | Najmniejszy blast radius i brak ingerencji w shell, sidebar, nawigację oraz ustawienia. |
| Q4. Czy usuwanie ma być odwracalne w tej fazie? | Nie dodajemy undo ani persystencji; callback jest jedynym miejscem, które może później włączyć historię/undo. | Discovery nie ma jeszcze storage ani API, więc lokalny punkt rozszerzenia jest odwracalny bez wymyślania drugiego modelu stanu. |

## 📋 Architecture

### Granice modułów

- \`packages/web/src/components/layout-context-menu.tsx\` — menu i obsługa zdarzenia \`contextmenu\`.
- \`packages/web/src/components/layout-registry.tsx\` oraz \`packages/web/src/lib/layout-elements.ts\` — istniejący lookup elementu, \`getSubtree\` i subskrypcja zmian.
- Właściciel przyszłego dashboardu/layoutu — podejmuje decyzję, jak usunąć element z modelu. Menu nie zna API serwera, storage ani struktury widgetu.
- Istniejący \`edit-mode-interaction-guard\` — pozostaje polityką dla kliknięć i submitów; otwarcie menu jest osobną, jawną akcją edytora.

### Przepływ

1. Layout provider renderuje warstwę menu obok zarejestrowanych elementów.
2. \`contextmenu\` na reprezentancie elementu jest zatrzymane tylko wtedy, gdy aktywny jest \`editMode\` i event ma najbliższy \`data-layout-id\`.
3. Menu zapisuje \`{ id, kind, subtree }\` jako cel i otwiera się przy współrzędnych eventu, z korektą do viewportu.
4. \`Delete\` wywołuje callback właściciela i zamyka menu. Callback nie jest wywoływany dla nieaktualnego/odmontowanego celu.
5. Właściciel aktualizuje deklaratywny model. Re-render usuwa DOM i unregisteruje elementy.

Nie dodajemy endpointu, zmian w \`packages/contract\`, zdarzeń SSE/WebSocket ani globalnego event busa.

## 📋 Data Model

Nie powstaje nowy model trwały. Menu używa istniejących typów discovery:

\`\`\`ts
type LayoutContextMenuTarget = {
  id: string
  kind: 'widget' | 'group'
  subtreeIds: string[]
}
\`\`\`

\`subtreeIds\` zawiera cel jako pierwszy element oraz jego potomków w kolejności \`LayoutRegistry.getSubtree\`. Dla widgetu zawiera dokładnie jeden \`id\`. Stan menu jest efemeryczny i jest czyszczony po zamknięciu, zmianie trasy, wyłączeniu edit mode oraz zmianie rejestru, jeśli cel zniknął.

Przyszła polityka potwierdzenia powinna być punktem rozszerzenia przed callbackiem, np. \`confirmDelete(target) => boolean | Promise<boolean>\`, ale nie jest implementowana ani konfigurowana w tej fazie. Dzięki temu późniejsze potwierdzenie grupy nie wymaga przepisywania hit-testu i menu.

## 📋 API Contracts

To kontrakt wewnętrzny klienta, nie HTTP API:

\`\`\`ts
type LayoutContextMenuProps = {
  enabled: boolean // właściciel przekazuje globalny editMode
  onDelete: (target: LayoutContextMenuTarget) => void
}
\`\`\`

Zachowanie:

- \`onDelete\` jest wywoływane najwyżej raz na aktywację pozycji;
- dla grupy target zawiera pełne poddrzewo, więc implementacja nie musi ponownie odpytywać DOM;
- target jest odrzucony, jeżeli element nie istnieje już w rejestrze lub nie należy do bieżącego providera;
- menu ma dostępną obsługę klawiaturą, Escape i kliknięcie poza menu;
- \`Delete\` ma nazwę i opis dostępnym dla czytnika ekranu; nie polega wyłącznie na kolorze czerwonym.

## 📋 UI/UX

Menu pojawia się przy prawym kliknięciu na widget lub grupę tylko w globalnym trybie edycji. Kliknięcie lewym przyciskiem poza menu zamyka je, a natywne menu przeglądarki pozostaje nietknięte poza zarejestrowanym layoutem i poza edit mode.

Pozycja \`Delete\` powinna używać istniejącego komponentu menu kontekstowego i tokenów kolorów repozytorium. Stan destructive może używać tonu destructive, ale musi zachować kontrast i fokus. Na krawędzi viewportu menu jest przesuwane do środka; przy scrollu nie może zostać poza ekranem.

Dla grupy tekst akcji pozostaje \`Delete\` / \`Usuń\`, bez cichej zmiany na „Delete group”. W przyszłości potwierdzenie może komunikować liczbę elementów w poddrzewie.

Mockup: [\`assets/layout-element-context-menu/mockup-01-context-menu.html\`](assets/layout-element-context-menu/mockup-01-context-menu.html).

## 📋 Edge Cases & Failure Scenarios

- **Kliknięcie prawym przyciskiem na dziecku grupy:** wybierany jest najbliższy element DOM, nie grupa nadrzędna.
- **Kliknięcie na paddingu kontenera niebędącego elementem:** menu się nie otwiera.
- **Element odmontowany przed wyborem \`Delete\`:** callback nie jest wywołany; menu zamyka się.
- **Grupa bez dzieci:** zachowuje semantykę grupy i jest usuwana jako jednoelementowe poddrzewo.
- **Grupa z głębokim poddrzewem:** zakres jest wyznaczany przez registry, bez rekurencji DOM i bez limitu zależnego od głębokości renderowania.
- **Edit mode wyłączony, gdy menu jest otwarte:** menu znika i nie można wykonać usunięcia.
- **Element nie ma DOM node:** nie może być celem hit-testu, ale nadal pozostaje poprawnym wpisem modelu.
- **Kliknięcie standardowej interakcji widgetu:** istniejący guard nadal działa; menu nie rozszerza wyjątków dla linków ani formularzy.
- **Błąd callbacku właściciela:** menu nie udaje sukcesu poprzez własną mutację; właściciel odpowiada za komunikat błędu i zachowanie modelu.

## 📋 Risks & Impact Review

Największe ryzyko to nieodwracalne usunięcie całej grupy po jednym kliknięciu. Ograniczamy je przez jawny target poddrzewa, punkt rozszerzenia pod potwierdzenie oraz pozostawienie persystencji i undo właścicielowi layoutu. Przed wdrożeniem produkcyjnym grupowego usuwania należy rozważyć włączenie potwierdzenia jako osobną fazę.

Ryzyko integracyjne jest niskie: zmiana jest klientowa, nie dotyka API ani danych serwera i nie obejmuje elementów shellu. Rollback polega na odmontowaniu menu i usunięciu callbacku; discovery oraz globalny guard nadal działają.

## 📋 Phasing

### Phase 1 — Menu i usuwanie widgetu

Zbudować context menu oparte na registry, z obsługą edit mode, dostępnością, pozycjonowaniem i callbackiem dla pojedynczego widgetu.

### Phase 2 — Usuwanie grupy i przygotowanie potwierdzenia

Rozszerzyć ten sam kontrakt o poddrzewo grupy, testy nested groups oraz stabilny seam \`confirmDelete\`, domyślnie nieaktywny. Nie implementować jeszcze dialogu, undo ani persystencji.

## 📋 Implementation Plan

### Phase 1 — Menu i usuwanie widgetu

1. **Zdefiniować target i callback menu.** Dodać typ wewnętrzny wykorzystujący \`LayoutElementKind\` i \`getSubtree\`; test kompilacyjny/typowy potwierdza brak ręcznie dublowanego API HTTP.
2. **Zaimplementować hit-test w edit mode.** Rozpoznawać najbliższy \`data-layout-id\`, nie skanować całego DOM; testy obejmują element, jego potomny tekst oraz kliknięcie poza layoutem.
3. **Dodać menu z jedną aktywną akcją.** Użyć repozytoryjnego komponentu menu, focus management, Escape, outside click i korektę viewportu; testy sprawdzają dostępność i brak menu poza edit mode.
4. **Podłączyć usuwanie widgetu do właściciela layoutu.** Callback otrzymuje jeden id, menu zamyka się, a registry nie jest mutowane bezpośrednio; test potwierdza pojedyncze wywołanie.

### Phase 2 — Usuwanie grupy i seam potwierdzenia

5. **Rozszerzyć target o poddrzewo.** Dla grupy przekazać grupę i potomków w deterministycznej kolejności; testy obejmują grupę pustą, widgety i nested groups.
6. **Dodać politykę potwierdzenia jako odroczony seam.** Wywołanie \`confirmDelete\` ma być opcjonalne i domyślnie przepuszczać akcję; test pinuje, że nie powstaje dialog ani konfiguracja w pierwszej fazie.
7. **Zintegrować z przykładowym layoutem dashboardu.** Ograniczyć menu do elementów discovery; test potwierdza brak menu dla shellu, sidebaru, nawigacji i ustawień.
8. **Wykonać gate i QA.** Uruchomić typecheck, testy web/unit, build oraz scenariusz browserowy: widget → menu → delete, grupa → menu → delete, Escape, poza edit mode i granice viewportu.

## 📋 Acceptance Criteria

- [ ] W edit mode prawy klik na zarejestrowanym widgetcie otwiera menu kontekstowe przy celu.
- [ ] W edit mode prawy klik na zarejestrowanej grupie otwiera to samo menu.
- [ ] Aktywna jest operacja \`Delete\` / \`Usuń\`; \`Edit\` i \`Move\` są wyraźnie odłożone albo nieaktywne bez sugerowania, że działają.
- [ ] Usunięcie widgetu przekazuje jeden stabilny \`id\` do właściciela layoutu.
- [ ] Usunięcie grupy przekazuje grupę i całe poddrzewo, w tym nested groups.
- [ ] Menu nie otwiera się dla shellu, sidebaru, nawigacji, ustawień ani niezarejestrowanego DOM.
- [ ] Menu nie ingeruje w standardową semantykę poza edit mode.
- [ ] Cel odmontowany przed aktywacją nie wywołuje \`onDelete\`.
- [ ] Escape, outside click, fokus klawiatury i korekta przy krawędzi viewportu działają.
- [ ] Istnieje punkt rozszerzenia pod przyszłe potwierdzenie, ale pierwsza wersja nie dodaje dialogu, undo, storage ani API.
- [ ] Testy i ręczne QA pokrywają widget, grupę, nested group oraz wyłączenie edit mode.

