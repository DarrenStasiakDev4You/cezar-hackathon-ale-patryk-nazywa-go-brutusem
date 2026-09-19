# Przesuwanie elementów w layoucie

## 📋 TLDR

Dodajemy możliwość zmiany kolejności elementów zarejestrowanych w layoucie podczas aktywnego globalnego trybu edycji. Użytkownik rozpoczyna przeciąganie po przekroczeniu małego progu ruchu, widzi jednoznaczny placeholder miejsca docelowego, a po puszczeniu element zostaje przeniesiony do nowej pozycji w obrębie tego samego rodzica. Zwykły hover, focus, click i prawy przycisk myszy zachowują odrębne znaczenie i nie mogą przypadkowo uruchamiać drag.

Faza nie dodaje zapisu layoutu, resize, usuwania, przenoszenia między kontenerami ani API. Zmiana jest lokalnym stanem klienta przygotowanym do późniejszej persystencji.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Czy ta specyfikacja obejmuje także zmianę rodzica elementu, np. przeniesienie widgetu do innej grupy? | Nie; v1 pozwala zmieniać kolejność rodzeństwa w jednym kontenerze. | To najmniejszy model, który dostarcza realne reorderowanie i nie wymaga reguł kompatybilności typów grup ani geometrii wielokontenerowej. | ok |
| Q2 | Czy zmiana ma być zapisywana po odświeżeniu lub przez API? | Nie; kolejność żyje w pamięci do czasu kolejnego reloadu. | Discovery i globalny edit mode nie mają jeszcze kontraktu persystencji; dodanie storage/API byłoby osobną zdolnością o większym blast radius. | ok |
| Q3 | Czy grupa jest przeciągana razem z całym poddrzewem? | Tak, grupa jest jednym elementem sortowalnym, a dzieci pozostają wewnątrz niej. | Użytkownik nie powinien przypadkowo rozrywać hierarchii; model rejestru już rozróżnia grupę i poddrzewo. | ok |
| Q4 | Czy v1 musi obsługiwać alternatywę klawiaturową? | Tak; uchwyt elementu ma standardową ścieżkę keyboard drag z dnd-kit. | Przeciąganie nie może być jedynym sposobem realizacji operacji dostępnej dla użytkownika klawiatury. | ok |
| Q5 | Czy mechanizm ma używać istniejącego dnd-kit, czy nowej implementacji pointer events? | Istniejący dnd-kit, skonfigurowany z małym activation distance i osobnym uchwytem. | Repo już używa dnd-kit w workflow builderze; ponowne użycie redukuje różnice w obsłudze touch, overlay i klawiatury. | ok |

## 📋 Problem Statement

`LayoutRegistry` opisuje stabilną tożsamość, typ i rodzica elementu, ale nie ma kolejności rodzeństwa ani interakcji, która tę kolejność zmienia. Globalny `editMode` i interaction guard rozdzielają już akcje edytora od akcji biznesowych, lecz użytkownik nadal nie może faktycznie zaprojektować widoku.

Największym ryzykiem UX jest pomieszanie pięciu podobnych sygnałów:

| Sygnał | Znaczenie | Zachowanie w v1 |
|---|---|---|
| hover | wskazanie elementu pod wskaźnikiem | pokazuje affordance elementu, nie zmienia kolejności |
| focus | wskazanie elementu dla klawiatury | pokazuje focus-visible i uchwyt, nie uruchamia ruchu |
| click | aktywacja elementu lub wybór | nie rozpoczyna drag i nie wykonuje biznesowej akcji w edit mode |
| right click | kontekst przeglądarki/edytora | nie rozpoczyna drag; context menu zachowuje dotychczasową politykę |
| drag | jawne przenoszenie | po przekroczeniu progu pokazuje overlay i placeholder; drop zatwierdza reorder |

Bez tej granicy pojedynczy pointerdown może jednocześnie wybrać widget, kliknięcie może wykonać jego akcję, a przypadkowe kilka pikseli ruchu może zmienić layout.

## 📋 Proposed Solution

W trybie edycji każdy zarejestrowany element sortowalny otrzymuje mały, jawny uchwyt drag. `DndContext` i `SortableContext` obsługują tylko powierzchnię layoutu, a `useSortable` jest podłączony do uchwytu, nie do całego widgetu. Aktywacja pointera następuje dopiero po przekroczeniu progu około 6 px; zwykły click pozostaje clickiem.

Podczas drag:

1. element źródłowy przechodzi w stan `dragging`, a jego wizualna kopia jest renderowana w `DragOverlay`;
2. elementy rodzeństwa pozostają w układzie, ale między nimi pojawia się jedna linia/slot drop, który opisuje dokładne miejsce wstawienia;
3. `over` aktualizuje wyłącznie kandydatkę pozycji, bez wywoływania akcji biznesowych i bez zapisu;
4. `dragEnd` zamienia kolejność identyfikatorów rodzeństwa w rejestrze/warstwie layoutu; drop na źródle lub poza dozwolonym kontenerem jest no-opem;
5. `dragCancel`, `pointercancel` lub utrata aktywnego celu przywraca poprzednią kolejność.

W v1 element może zostać wstawiony przed lub za rodzeństwem w tym samym rodzicu. Grupa porusza się jako jeden wpis, a jej `children` i ich wewnętrzna kolejność nie zmieniają się. Nie pokazujemy fałszywego drop targetu dla elementu z innego rodzica.

### Research and rejected alternatives

- Istniejący workflow builder potwierdza wzorzec: `PointerSensor` z małym dystansem aktywacji, `DragOverlay`, `SortableContext` oraz `sortableKeyboardCoordinates`. Ten wzorzec rozdziela kliknięcie od drag i ma już testy w repo.
- `react-grid-layout` modeluje układ jako stabilne identyfikatory i osobne pozycje, z placeholderem oraz strategiami kolizji, ale wprowadza cięższy model współrzędnych, resize i compaction. Dla v1 reorderowania rodzeństwa byłoby to przedwczesne ([README](https://github.com/react-grid-layout/react-grid-layout)).
- Własny globalny pointer-event state machine został odrzucony: dublowałby istniejący prymityw dnd-kit i zwiększał ryzyko rozjazdu między mouse, touch i keyboard.
- HTML5 `draggable` został odrzucony dla tej powierzchni: repo używa go tylko dla prostych legacy flow, a tutaj potrzebujemy jednolitego overlay, progu aktywacji, touch i keyboard.

## 📋 Architecture

### Moduły i odpowiedzialności

- `packages/web/src/lib/layout-elements.ts` — dodać jawny, niemutujący model kolejności rodzeństwa oraz operację `moveBefore`/`moveAfter` z walidacją tego samego `parentId`.
- `packages/web/src/components/layout-registry.tsx` — udostępnić kolejność i stabilne aktualizacje dla jednego layoutu; provider pozostaje właścicielem instancji.
- `packages/web/src/components/layout-element.tsx` — zachować deklaratywny wrapper i dodać semantyczny uchwyt/slot tylko wtedy, gdy aktywny jest edit mode.
- nowy komponent, np. `packages/web/src/components/layout-sortable-surface.tsx` — jedna granica `DndContext`, sensory, `onDragStart/Over/End/Cancel`, overlay i placeholder.
- `packages/web/src/components/app-shell.tsx` — bez nowej polityki per-widget; istniejący guard nadal blokuje click/submit i przepuszcza wyłącznie jawne akcje edytora.
- `packages/web/src/styles/index.css` — stany `hover`, `focus-visible`, `dragging` i drop indicator bez zmiany wymiarów elementu poza przeznaczoną przestrzenią placeholdera.

### Przepływ stanu

1. Surface odczytuje snapshot rejestru i grupuje elementy po `parentId`.
2. `useSortable` zna wyłącznie `id`, `parentId` i pozycję w rodzeństwie; nie czyta ani nie zapisuje danych domenowych widgetu.
3. Start drag zapisuje `activeId` i kolejność początkową w refie.
4. `overId` wyznacza indeks docelowy; UI pokazuje placeholder, ale nie mutuje docelowego layoutu przy każdym ruchu wskaźnika.
5. End wywołuje jedną czystą operację reorder. Rejestr publikuje nowy snapshot, a komponenty renderują nową kolejność.

### Rozdzielenie interakcji

- Uchwyt drag ma `data-edit-mode-action="allow"`, aby nie został zablokowany przez globalny guard.
- Kliknięcie w treść widgetu nie jest uchwytem i pozostaje zablokowane w edit mode zgodnie z istniejącą polityką; nie może wywołać reorder.
- `pointerdown` na uchwycie tylko uzbraja sensor. Drag zaczyna się po activation distance; przed tym `click` nie jest anulowany.
- `contextmenu` nie przechodzi do logiki sortowania. Prawy przycisk nie ustawia `activeId` i nie pokazuje placeholdera.
- Hover/focus aktualizują wyłącznie style i opis dostępnościowy. Nie zmieniają rejestru.
- Podczas aktywnego drag biznesowe callbacki, linki, dropdowny i submit pozostają zablokowane przez guard; overlay nie może ich zawierać jako aktywnych kontrolek.

## 📋 Data Model

Obecny descriptor zostaje rozszerzony o kolejność wyliczaną z tablicy wpisów layoutu, bez zmiany `id`, `kind` i `parentId`:

```ts
type LayoutPlacement = {
  id: string
  parentId?: string
  order: number
}

type LayoutMove = {
  id: string
  targetId: string | null // null = koniec tego samego kontenera
  position: 'before' | 'after'
}
```

`order` jest lokalny dla jednego `parentId` i nie jest pozycją CSS ani współrzędną. Źródłem prawdy ma być jedna uporządkowana kolekcja; `children` w snapshotach pozostaje projekcją, aby nie utrzymywać dwóch niezależnych kolejności.

Stan jest tylko in-memory. Nie dodajemy localStorage, migracji, serwerowego payloadu, endpointu, SSE/WebSocket ani zmian w `extension-api`. Przyszła persystencja powinna dostać osobny kontrakt, który zapisuje pełny, walidowany layout, a nie pojedyncze zdarzenia pointera.

## 📋 API Contracts

Brak zmian HTTP, CLI i kontraktów pakietowych. Wewnętrzny kontrakt klienta powinien wystawić czyste operacje:

```ts
type LayoutRegistry = {
  getSnapshot(): RegisteredLayoutElement[]
  moveWithinParent(move: LayoutMove): boolean
  getSiblingIds(parentId?: string): string[]
}
```

`moveWithinParent` zwraca `false` dla nieznanego źródła/celu, innego rodzica, próby przeniesienia do własnego poddrzewa lub braku zmiany. Operacja nie mutuje argumentów i nie emituje częściowego snapshotu. Nie wolno realizować reorderu przez zmianę DOM lub skanowanie dokumentu.

## 📋 UI/UX

### Stany elementu

- **Normalny:** element zachowuje dotychczasowy wygląd.
- **Hover:** pojawia się subtelny obrys/uchwyt, ale layout i akcje pozostają bez zmian.
- **Focus:** uchwyt ma widoczny `focus-visible`; focus nie rozpoczyna drag.
- **Pressed/arming:** po pointerdown uchwyt może pokazać stan pressed, ale do przekroczenia progu nie ma placeholdera ani zmiany kolejności.
- **Dragging:** źródło zachowuje miejsce w układzie jako półprzezroczysty slot, overlay podąża za wskaźnikiem, a aktywny drop slot ma kontrastowy obrys i tekst/oznaczenie miejsca.
- **Dropped:** placeholder znika, element renderuje się w nowej kolejności, a krótki status dostępnościowy komunikuje „Moved {label}”.
- **Cancelled/invalid:** układ wraca do stanu początkowego bez toastu błędu dla zwykłego anulowania.

### Gesty i klawiatura

- Pointer/touch: uchwyt, activation distance około 6 px, pointer capture zapewniony przez dnd-kit.
- Click: przy ruchu poniżej progu pozostaje clickiem; sam click nie przenosi elementu.
- Right click: nie rozpoczyna drag i nie zmienia układu.
- Escape: anuluje aktywne przeciąganie i przywraca kolejność.
- Keyboard: focus na uchwycie, Space rozpoczyna „lift”, strzałki zmieniają pozycję wśród rodzeństwa, Space zatwierdza, Escape anuluje. Użytkownik otrzymuje `aria-live` z aktywnym elementem i bieżącą pozycją.
- Touch scroll: dotknięcie poza uchwytem nadal przewija; nie ustawiamy `touch-action: none` na całym widgetcie.

### Responsive i grupy

Na desktopie placeholder ma szerokość/kształt elementu, a overlay jest ograniczony do powierzchni layoutu. Na mobile uchwyt pozostaje minimum 44×44 px, a slot jest widoczny również przy wąskiej kolumnie. Grupa jest przeciągana jako karta/slot grupy; jej dzieci nie stają się osobnymi celami dla bieżącego drag.

Makieta: `assets/przesuwanie-elementow/mockup-01-dragging-widget.html` oraz wyrenderowany PNG obok niej.

## 📋 Edge Cases & Failure Scenarios

- Drop poza kontenerem, na własny element lub na element z innym rodzicem: brak zmiany, bez wyjątku dla użytkownika.
- Drop na własny placeholder: no-op; nie tworzyć duplikatu ani pustego slotu.
- Szybki click bez przekroczenia progu: callback drag nie jest wywołany.
- Pointer cancel, Escape, zamknięcie overlay lub unmount źródła: przywrócić kolejność początkową i wyczyścić stan aktywnego drag.
- React Strict Mode i re-render w trakcie drag: identyfikator aktywnego elementu pozostaje stabilny; brak podwójnego wpisu i brak wycieku listenerów.
- Dynamiczny mount/unmount: rejestr odrzuca nieaktualny target; bieżący drag kończy się anulowaniem, jeśli źródło znika.
- Zagnieżdżone grupy: reorder zmienia tylko rodzeństwo grupy; nie można wciągnąć elementu do własnego poddrzewa.
- Element z przyciskiem/linkiem w środku: pointerdown poza uchwytem nie uzbraja drag; click i right click są obsługiwane przez istniejący guard.
- Brak możliwości pomiaru geometrii: placeholder używa fallbacku z prostokąta źródła, a drop jest nadal walidowany logicznie.
- Błąd wewnętrznej operacji reorder: pozostawić stary snapshot, zakończyć drag jako cancelled i nie pokazywać układu częściowo zmienionego.

## 📋 Risks & Impact Review

Największe ryzyko to złapanie całej karty zamiast uchwytu, co blokowałoby click, focus i istniejące interakcje. Ogranicza je osobny handle, activation distance, testy macierzy zdarzeń i brak `pointer-events: none` na powierzchni.

Drugie ryzyko to rozjazd kolejności w rejestrze i DOM. Jedna uporządkowana kolekcja oraz czysta operacja `moveWithinParent` są źródłem prawdy; DOM jest tylko projekcją. Brak persystencji oznacza, że rollback jest natychmiastowy przez Escape/cancel, a pełny rollback release’u to revert zmian klienta.

Nie ma zmian w danych serwerowych, trasach, auth, configu, rozszerzeniach ani kompatybilności wstecznej. Nie dodajemy zależności, ponieważ dnd-kit już jest zależnością `packages/web`.

## 📋 Phasing

### Phase 1 — Uporządkowany model layoutu

Rozszerzyć rejestr o kolejność rodzeństwa i czyste operacje reorder, wraz z walidacją tego samego rodzica i ochroną poddrzewa. Faza kończy się działającym modelem bez UI.

### Phase 2 — Pointer/touch drag surface

Dodać `DndContext`, sensory, handle, overlay, placeholder i drop commit na powierzchni layoutu. Faza kończy się działającym przesuwaniem widgetów i grup w edit mode.

### Phase 3 — Keyboard, guard i regresje UX

Dodać keyboard drag, komunikaty live region oraz pełną macierz hover/focus/click/right click/drag, w tym anulowanie i responsywność. Faza kończy się dowodem testowym i przeglądarkowym.

## 📋 Implementation Plan

### Phase 1 — Uporządkowany model layoutu

1. Zmapować wszystkie miejsca użycia `LayoutRegistry`, `LayoutElement` i `editMode`; potwierdzić, że nie powstaje druga lista kolejności. Wynik testowalny: fixture z dwoma root widgetami, widgetami w grupie i zagnieżdżoną grupą.
2. Dodać uporządkowaną kolekcję rodzeństwa oraz `getSiblingIds`; testy zachowują stabilną kolejność po rejestracji, unmount i Strict Mode.
3. Zaimplementować `moveWithinParent`/`moveBefore`/`moveAfter`; testy obejmują początek, środek, koniec, no-op, innego rodzica i własne poddrzewo.
4. Utrzymać snapshot niemutowalny i publikować dokładnie jedną zmianę po udanym dropie; test wykrywa brak częściowego stanu.

### Phase 2 — Pointer/touch drag surface

5. Dodać jedną powierzchnię sortowalną z istniejącym dnd-kit; test potwierdza, że widget spoza edit mode nie ma uchwytu ani aktywnego sensora.
6. Podłączyć uchwyt z activation distance około 6 px i `data-edit-mode-action="allow"`; test rozróżnia click bez ruchu od drag po progu.
7. Dodać `DragOverlay`, placeholder i drop indicator przed/za rodzeństwem; test renderuje aktywny stan i prawidłowy target.
8. Zatwierdzić reorder tylko w `onDragEnd`; test potwierdza, że `onDragOver` nie mutuje rejestru, a cancel/invalid drop przywraca stan.
9. Obsłużyć grupę jako pojedynczy wpis sortowalny; test potwierdza niezmienność kolejności i parentId dzieci.

### Phase 3 — Keyboard, guard i regresje UX

10. Dodać keyboard coordinates, Space/arrow/Escape i `aria-live`; testy sprawdzają lift, przesunięcie, commit i cancel bez aktywacji biznesowej akcji.
11. Dodać macierz zdarzeń: hover/focus nie mutują, click poniżej progu nie mutuje, right click nie uzbraja drag, drag po uchwycie mutuje tylko po dropie.
12. Zweryfikować mobile, touch scroll, Light/Dark, focus-visible, min. 44 px uchwytu i brak poziomego overflow w testach komponentowych/przeglądarkowych.
13. Uruchomić gate repozytorium: `npm run typecheck`, `npm test`, `npm run test:unit`, `npm run build`, `npm run test:package`; opisać ewentualne niezwiązane awarie.

## 📋 Acceptance Criteria

- [ ] W edit mode użytkownik może przeciągnąć widget na inną pozycję wśród elementów tego samego rodzica.
- [ ] Grupa jest przenoszona jako całość; dzieci nie zmieniają rodzica ani wewnętrznej kolejności.
- [ ] Placeholder/drop indicator pokazuje dokładne miejsce docelowe podczas drag.
- [ ] Click bez przekroczenia progu nie rozpoczyna drag i nie zmienia kolejności.
- [ ] Hover i focus pokazują affordance, ale nie mutują layoutu.
- [ ] Right click nie rozpoczyna drag ani nie zmienia kolejności.
- [ ] Escape, pointercancel i invalid drop przywracają stan początkowy.
- [ ] Keyboard drag jest możliwy z uchwytu i ma komunikat live region.
- [ ] Istniejący interaction guard nadal blokuje biznesowe click/submit/dropdowny; handle edytora jest jawnie dozwolony.
- [ ] Tryb normalny nie ma uchwytów, placeholderów ani zmiany zachowania istniejących widgetów.
- [ ] Nie dodano API, persystencji, resize, usuwania, przenoszenia między rodzicami ani nowej zależności.

