# Przesuwanie elementów w layoucie

## 📋 Skrót

Dodajemy wizualny edytor layoutu w faktycznym cockpitcie Cezara, uruchamiany przez globalny tryb edycji. Cały widok — poza aktywnie wskazanym elementem — jest wtedy wyszarzony, aby użytkownik widział, że edytuje strukturę, a nie uruchamia funkcje biznesowe. Hover przywraca pełny kolor wskazanego elementu.

Użytkownik może przeciągnąć cały boczny blok menu z jednej strony layoutu na drugą. „Cały blok” oznacza dokładnie całą sekcję zaznaczoną czerwoną ramką na ekranie: logo i repozytorium, przycisk New task, wszystkie pozycje nawigacji, przełącznik Active/Archived, empty state oraz dolny toolbar z Search/Tools. Nie przenosimy pojedynczej pozycji jako zamiennika całego bloku. Pojedynczy element można reorderować dopiero wewnątrz całego przeniesionego bloku, niezależnie od tego, czy blok znajduje się po lewej, czy po prawej stronie. Podczas dragowania widoczny jest placeholder całego bloku, a po puszczeniu cała sekcja pojawia się po drugiej stronie.

## 📋 Rozstrzygnięte założenia (domyślne decyzje autonomiczne)

| # | Pytanie | Zastosowane założenie | Uzasadnienie | Potwierdzenie? |
|---|---|---|---|---|
| Q1 | Czy element można upuścić w głównej części treści albo w innym menu? | Nie; element reorderuje się wyłącznie wewnątrz własnego menu. Położenie tego menu — lewa lub prawa strona — nie ma znaczenia. | Edytor porządkuje zawartość menu; główna treść i inne menu nie są celami. | ok |
| Q2 | Czy zmiana ma być zapisywana po odświeżeniu lub przez API? | Nie; kolejność żyje w pamięci do czasu kolejnego przeładowania. | Discovery i globalny tryb edycji nie mają jeszcze kontraktu persystencji; dodanie storage/API byłoby osobną zdolnością o większym zakresie ryzyka. | tak |
| Q3 | Co dokładnie jest grupą przenoszoną między stronami? | Cały boczny blok zaznaczony czerwoną ramką: nagłówek, New task, nawigacja, Active/Archived, empty state i dolny toolbar. | Eliminuje niejednoznaczność: drag nie dotyczy pojedynczego wpisu, tylko kompletnego panelu bocznego. | ok |
| Q4 | Czy v1 musi obsługiwać alternatywę klawiaturową? | Tak; uchwyt elementu ma standardową ścieżkę przeciągania klawiaturą z dnd-kit. | Przeciąganie nie może być jedynym sposobem realizacji operacji dostępnej dla użytkownika klawiatury. | tak |
| Q5 | Czy mechanizm ma używać istniejącego dnd-kit, czy nowej implementacji zdarzeń wskaźnika? | Istniejący dnd-kit, skonfigurowany z małą odległością aktywacji i osobnym uchwytem. | Repozytorium już używa dnd-kit w kreatorze workflow; ponowne użycie redukuje różnice w obsłudze dotyku, kopii elementu i klawiatury. | tak |

## 📋 Opis problemu

`LayoutRegistry` opisuje stabilną tożsamość, typ i rodzica elementu, ale nie ma kolejności rodzeństwa ani interakcji, która tę kolejność zmienia. Globalny `editMode` i guard interakcji rozdzielają już akcje edytora od akcji biznesowych, lecz użytkownik nadal nie może faktycznie zaprojektować widoku.

Największym ryzykiem UX jest pomieszanie pięciu podobnych sygnałów:

| Sygnał | Znaczenie | Zachowanie w v1 |
|---|---|---|
| hover | wskazanie elementu pod wskaźnikiem | pokazuje informację o elemencie, nie zmienia kolejności |
| focus | wskazanie elementu dla klawiatury | pokazuje `focus-visible` i uchwyt, nie uruchamia ruchu |
| click | aktywacja elementu lub wybór | nie rozpoczyna przeciągania i nie wykonuje biznesowej akcji w trybie edycji |
| right click | kontekst przeglądarki/edytora | nie rozpoczyna przeciągania; menu kontekstowe zachowuje dotychczasową politykę |
| drag | jawne przenoszenie | po przekroczeniu progu pokazuje kopię elementu i miejsce docelowe; upuszczenie zatwierdza zmianę kolejności |

Bez tej granicy pojedynczy pointerdown może jednocześnie wybrać widget, kliknięcie może wykonać jego akcję, a przypadkowe kilka pikseli ruchu może zmienić layout. Obecna makieta dodatkowo rozmija się z aplikacją: pokazuje fikcyjne karty dashboardu, podczas gdy ekran Cezara ma stały ciemny sidebar, żółty pasek edycji, Tasks/Active/Archived, wyszukiwarkę i pusty stan „No tasks yet”.

## 📋 Proponowane rozwiązanie

W trybie edycji cały boczny blok otrzymuje jeden jawny uchwyt/obszar dragowania. Ramka dragowania obejmuje pełną wysokość panelu, od logo do dolnego toolbara. Jego elementy otrzymują osobne uchwyty reorderowania dopiero po przeniesieniu bloku. Ten sam mechanizm działa identycznie po lewej i po prawej stronie. Cały aktywny widok dostaje warstwę dimmingu; blok pod hoverem oraz blok dragowany odzyskują pełny kolor. Główna część treści nie jest strefą dropu.

Podczas przeciągania:

1. element źródłowy przechodzi w stan `dragging`, a jego wizualna kopia jest renderowana w `DragOverlay`;
2. elementy rodzeństwa pozostają w układzie, ale między nimi pojawia się jedna linia lub strefa upuszczenia opisująca dokładne miejsce wstawienia;
3. `over` aktualizuje wyłącznie kandydatkę pozycji, bez wywoływania akcji biznesowych i bez zapisu;
4. `dragEnd` rozstrzyga cel: cały boczny blok może zmienić stronę, a element może zmienić kolejność dopiero wewnątrz tego bloku; placeholder ma rozmiar całego panelu;
5. `dragCancel`, `pointercancel` lub utrata aktywnego celu przywraca poprzednią kolejność.

Element może zostać wstawiony przed lub za rodzeństwem wyłącznie w menu swojej grupy. Ta reguła jest taka sama po lewej i po prawej stronie. Grupa porusza się jako jeden wpis z całą zawartością między stronami. Nie pokazujemy stref dropu w głównej treści ani między różnymi menu.

### Wnioski z analizy i odrzucone alternatywy

- Istniejący kreator workflow potwierdza wzorzec: `PointerSensor` z małym dystansem aktywacji, `DragOverlay`, `SortableContext` oraz `sortableKeyboardCoordinates`. Ten wzorzec rozdziela kliknięcie od przeciągania i ma już testy w repozytorium.
- `react-grid-layout` modeluje układ jako stabilne identyfikatory i osobne pozycje, z placeholderem oraz strategiami kolizji, ale wprowadza cięższy model współrzędnych, resize i compaction. Dla v1 reorderowania rodzeństwa byłoby to przedwczesne ([README](https://github.com/react-grid-layout/react-grid-layout)).
- Własna globalna maszyna stanów zdarzeń wskaźnika została odrzucona: dublowałaby istniejący prymityw dnd-kit i zwiększała ryzyko rozjazdu między myszą, dotykiem i klawiaturą.
- HTML5 `draggable` został odrzucony dla tej powierzchni: repozytorium używa go tylko dla prostych starszych przepływów, a tutaj potrzebujemy jednolitej kopii elementu, progu aktywacji, dotyku i klawiatury.

## 📋 Architektura

### Moduły i odpowiedzialności

- `packages/web/src/lib/layout-elements.ts` — dodać jawny, niemutujący model stron, grup i kolejności rodzeństwa oraz operację `moveBefore`/`moveAfter` z walidacją tego samego menu.
- `packages/web/src/components/layout-registry.tsx` — udostępnić kolejność i stabilne aktualizacje dla jednego layoutu; dostawca kontekstu pozostaje właścicielem instancji.
- `packages/web/src/components/layout-element.tsx` — zachować deklaratywny wrapper i dodać semantyczny uchwyt lub strefę tylko wtedy, gdy aktywny jest tryb edycji.
- nowy komponent, np. `packages/web/src/components/layout-sortable-surface.tsx` — granice `DndContext` dla obu menu, sensory, dimming, hover reveal, `onDragStart/Over/End/Cancel`, kopia grupy/elementu i strefy drop wyłącznie w dozwolonym menu.
- `packages/web/src/components/app-shell.tsx` — bez nowej polityki per-widget; istniejący guard nadal blokuje kliknięcie/wysłanie formularza i przepuszcza wyłącznie jawne akcje edytora.
- `packages/web/src/styles/index.css` — stany `hover`, `focus-visible`, `dragging` i wskaźnika miejsca upuszczenia bez zmiany wymiarów elementu poza przeznaczoną przestrzenią symbolu miejsca docelowego.

### Przepływ stanu

1. Powierzchnia sortowania odczytuje snapshot rejestru i grupuje elementy po `side`, `groupId` i pozycji w menu.
2. `useSortable` zna wyłącznie `id`, `side`, `groupId` i pozycję w rodzeństwie; nie czyta ani nie zapisuje danych domenowych widgetu.
3. Początek przeciągania zapisuje `activeId` i kolejność początkową w refie.
4. `overId` wyznacza indeks docelowy; interfejs pokazuje symbol miejsca docelowego, ale nie zmienia właściwego layoutu przy każdym ruchu wskaźnika.
5. Zakończenie przeciągania wywołuje jedną czystą operację zmiany kolejności. Rejestr publikuje nowy snapshot, a komponenty renderują nową kolejność.

### Rozdzielenie interakcji

- Uchwyt przeciągania ma `data-edit-mode-action="allow"`, aby nie został zablokowany przez globalny guard.
- Kliknięcie w treść widgetu nie jest uchwytem i pozostaje zablokowane w trybie edycji zgodnie z istniejącą polityką; nie może wywołać zmiany kolejności.
- `pointerdown` na uchwycie tylko uzbraja sensor. Przeciąganie zaczyna się po przekroczeniu odległości aktywacji; wcześniej `click` nie jest anulowany.
- `contextmenu` nie przechodzi do logiki sortowania. Prawy przycisk nie ustawia `activeId` i nie pokazuje placeholdera.
- Najechanie i fokus aktualizują wyłącznie style i opis dostępnościowy. Nie zmieniają rejestru.
- Podczas aktywnego przeciągania biznesowe callbacki, linki, dropdowny i wysłanie formularza pozostają zablokowane przez guard; kopia elementu nie może zawierać aktywnych kontrolek.

## 📋 Model danych

Obecny descriptor zostaje rozszerzony o stronę, grupę i kolejność wyliczaną z tablicy wpisów layoutu, bez zmiany `id` i `kind`:

```ts
type LayoutPlacement = {
  id: string
  side: 'left' | 'right'
  groupId?: string
  order: number
}

type LayoutMove = {
  id: string
  targetId: string | null // null = koniec wybranego kontenera
  position: 'before' | 'after' | 'inside'
}
```

`order` jest lokalny dla jednego `side` i `groupId`, a nie jest pozycją CSS ani współrzędną. Źródłem prawdy ma być jedna uporządkowana kolekcja; zawartość grupy pozostaje projekcją, aby nie utrzymywać dwóch niezależnych kolejności.

Stan jest tylko w pamięci. Nie dodajemy localStorage, migracji, serwerowego payloadu, endpointu, SSE/WebSocket ani zmian w `extension-api`. Przyszła persystencja powinna dostać osobny kontrakt, który zapisuje pełny, walidowany layout, a nie pojedyncze zdarzenia wskaźnika.

## 📋 Kontrakty API

Brak zmian HTTP, CLI i kontraktów pakietowych. Wewnętrzny kontrakt klienta powinien wystawić czyste operacje:

```ts
type LayoutRegistry = {
  getSnapshot(): RegisteredLayoutElement[]
  moveWithinMenu(move: LayoutMove): boolean
  moveGroupToSide(groupId: string, side: 'left' | 'right'): boolean
  getSiblingIds(side: 'left' | 'right', groupId?: string): string[]
}
```

`moveWithinMenu` zwraca `false` dla nieznanego źródła/celu, innej strony, innej grupy lub braku zmiany. `moveGroupToSide` przenosi grupę wraz z zawartością i zachowuje jej wewnętrzną kolejność. Operacje nie mutują argumentów i nie emitują częściowego snapshotu. Nie wolno realizować reorderu przez zmianę DOM lub skanowanie dokumentu.

## 📋 Interfejs i doświadczenie użytkownika

### Stany elementu

- **Normalny:** element zachowuje dotychczasowy wygląd.
- **Edit idle:** cały widok jest wyszarzony; struktura jest czytelna, ale akcje biznesowe są wizualnie wyciszone.
- **Hover:** wskazany element odzyskuje pełny kolor i dostaje subtelny obrys/uchwyt; hover nie zmienia struktury.
- **Focus:** uchwyt ma widoczny `focus-visible`; fokus nie rozpoczyna przeciągania.
- **Pressed/arming:** po pointerdown uchwyt może pokazać stan pressed, ale do przekroczenia progu nie ma placeholdera ani zmiany kolejności.
- **Dragging grupy:** źródło zachowuje miejsce jako półprzezroczysta strefa, kopia całego menu podąża za wskaźnikiem, a aktywna strona pokazuje „przenieś menu tutaj”.
- **Dragging elementu:** kopia elementu podąża za wskaźnikiem, a aktywne miejsce pokazuje wyłącznie dozwoloną pozycję w menu tej samej strony.
- **Dropped:** symbol miejsca docelowego znika, element renderuje się w nowej kolejności, a krótki status dostępnościowy komunikuje „Przeniesiono: {label}”.
- **Anulowane lub nieprawidłowe:** układ wraca do stanu początkowego bez komunikatu błędu.

### Gesty i klawiatura

- Wskaźnik/dotyk: uchwyt, odległość aktywacji około 6 px, przejęcie wskaźnika zapewnione przez dnd-kit.
- Kliknięcie: przy ruchu poniżej progu pozostaje kliknięciem; samo kliknięcie nie przenosi elementu.
- Prawy przycisk: nie rozpoczyna przeciągania i nie zmienia układu.
- Escape: anuluje aktywne przeciąganie i przywraca kolejność.
- Klawiatura: fokus na uchwycie, Spacja rozpoczyna „podniesienie”, strzałki zmieniają pozycję wśród rodzeństwa, Spacja zatwierdza, Escape anuluje. Użytkownik otrzymuje `aria-live` z aktywnym elementem i bieżącą pozycją.
- Przewijanie dotykiem: dotknięcie poza uchwytem nadal przewija; nie ustawiamy `touch-action: none` na całym widgetcie.

### Responsywność i grupy

Makiety odtwarzają rzeczywisty pusty ekran Cezara i czerwonym obrysem wskazują cały boczny blok: logo/repo, New task, nawigację, Active/Archived, empty state i dolny toolbar. Pokazują trzy stany: przed ruchem, w trakcie przenoszenia całego bloku na drugą stronę oraz po przeniesieniu, gdy element jest reorderowany wewnątrz kompletnego panelu. Główna część treści nie zawiera stref drop.

Makiety HTML: `assets/przesuwanie-elementow/mockup-01-before.html`, `mockup-02-group-dragging.html`, `mockup-03-after-reorder.html`. Render PNG nie został wygenerowany, ponieważ lokalny Chromium kończy się błędem procesu w tym środowisku.

## 📋 Przypadki brzegowe i scenariusze awarii

- Upuszczenie grupy poza dozwoloną stroną/menu: brak zmiany, bez wyjątku dla użytkownika.
- Upuszczenie elementu na główną część treści albo do menu innej grupy: brak zmiany i brak placeholdera.
- Drop elementu wewnątrz kompletnego przeniesionego panelu zmienia wyłącznie kolejność rodzeństwa; działa identycznie po lewej i po prawej stronie.
- Drop grupy na drugą stronę zachowuje wszystkie elementy i ich wewnętrzną kolejność.
- Upuszczenie na własny symbol miejsca docelowego: nic nie zmieniać; nie tworzyć duplikatu ani pustej strefy.
- Szybkie kliknięcie bez przekroczenia progu: callback przeciągania nie jest wywołany.
- Anulowanie wskaźnika, Escape, zamknięcie kopii lub odmontowanie źródła: przywrócić kolejność początkową i wyczyścić stan aktywnego przeciągania.
- React Strict Mode i ponowne renderowanie w trakcie przeciągania: identyfikator aktywnego elementu pozostaje stabilny; brak podwójnego wpisu i brak wycieku listenerów.
- Dynamiczne zamontowanie/odmontowanie: rejestr odrzuca nieaktualny cel; bieżące przeciąganie kończy się anulowaniem, jeśli źródło znika.
- Dwie strony z menu: elementy nie przekraczają granicy menu; tylko uchwyt grupy może przenieść całe menu na drugą stronę.
- Element z przyciskiem lub linkiem w środku: `pointerdown` poza uchwytem nie uzbraja przeciągania; kliknięcie i prawy przycisk są obsługiwane przez istniejący guard.
- Brak możliwości pomiaru geometrii: symbol miejsca docelowego używa wartości zastępczej z prostokąta źródła, a upuszczenie jest nadal walidowane logicznie.
- Błąd wewnętrznej operacji zmiany kolejności: pozostawić stary snapshot, zakończyć przeciąganie jako anulowane i nie pokazywać układu częściowo zmienionego.

## 📋 Przegląd ryzyka i wpływu

Największe ryzyko to złapanie całej karty zamiast uchwytu, co blokowałoby kliknięcie, fokus i istniejące interakcje. Ograniczają je osobny uchwyt, odległość aktywacji, testy macierzy zdarzeń i brak `pointer-events: none` na powierzchni.

Drugie ryzyko to rozjazd kolejności w rejestrze i DOM. Jedna uporządkowana kolekcja oraz czyste operacje `moveWithinMenu`/`moveGroupToSide` są źródłem prawdy; DOM jest tylko projekcją. Brak persystencji oznacza, że cofnięcie jest natychmiastowe przez Escape/anulowanie, a pełne wycofanie wydania to revert zmian klienta.

Nie ma zmian w danych serwerowych, trasach, auth, configu, rozszerzeniach ani kompatybilności wstecznej. Nie dodajemy zależności, ponieważ dnd-kit już jest zależnością `packages/web`.

## 📋 Fazy wdrożenia

### Faza 1 — Uporządkowany model layoutu

Rozszerzyć rejestr o strony, grupy, kolejność rodzeństwa i czyste operacje zmiany kolejności, wraz z walidacją tego samego menu. Faza kończy się działającym modelem bez interfejsu użytkownika.

### Faza 2 — Powierzchnia przeciągania menu i dimming

Dodać `DndContext` dla lewego i prawego menu, sensory, uchwyt grupy, kopię całej grupy, placeholder drugiej strony i zatwierdzenie upuszczenia. Faza kończy się działającym przesuwaniem grup między stronami bez stref drop w głównej treści.

### Faza 3 — Klawiatura, guard i regresje UX

Dodać przeciąganie klawiaturą, komunikaty regionu live oraz pełną macierz najechania, fokusu, kliknięcia, prawego przycisku i przeciągania, w tym anulowanie i responsywność. Faza kończy się dowodem testowym i przeglądarkowym.

## 📋 Plan wdrożenia

### Faza 1 — Uporządkowany model layoutu

1. Zmapować wszystkie miejsca użycia `LayoutRegistry`, `LayoutElement` i `editMode`; potwierdzić, że nie powstaje druga lista kolejności. Wynik testowalny: fixture z dwoma widgetami głównymi, widgetami w grupie i zagnieżdżoną grupą.
2. Dodać uporządkowaną kolekcję rodzeństwa oraz `getSiblingIds`; testy zachowują stabilną kolejność po rejestracji, odmontowaniu i Strict Mode.
3. Zaimplementować `moveWithinMenu` oraz `moveGroupToSide`; testy obejmują początek, środek, koniec, brak zmiany, inną stronę elementu i przeniesienie całej grupy.
4. Utrzymać snapshot niemutowalny i publikować dokładnie jedną zmianę po udanym upuszczeniu; test wykrywa brak częściowego stanu.

### Faza 2 — Powierzchnia przeciągania wskaźnikiem i dotykiem

5. Dodać jedną powierzchnię sortowalną z istniejącym dnd-kit; test potwierdza, że widget poza trybem edycji nie ma uchwytu ani aktywnego sensora.
6. Podłączyć uchwyt z odległością aktywacji około 6 px i `data-edit-mode-action="allow"`; test rozróżnia kliknięcie bez ruchu od przeciągania po przekroczeniu progu.
7. Dodać `DragOverlay`, placeholder drugiej strony dla grupy oraz strefy przed/za rodzeństwem wyłącznie w menu tej samej grupy.
8. Zatwierdzić zmianę strony grupy lub reorder elementu wyłącznie w `onDragEnd`; test potwierdza brak zmiany po dropie w głównej treści i anulowanie.
9. Dodać dimming całego widoku oraz hover reveal pełnego koloru; test sprawdza, że hover nieprzeciąganego elementu przywraca jego kontrast.
10. Obsłużyć grupę jako pojedynczy wpis z całą zawartością oraz element jako wpis reorderowalny wyłącznie w swoim menu; test potwierdza oba warianty.

### Faza 3 — Klawiatura, guard i regresje UX

11. Dodać współrzędne klawiatury, Spację/strzałki/Escape i `aria-live`; testy obejmują zmianę strony grupy oraz reorder w menu bez aktywacji biznesowej akcji.
12. Dodać macierz zdarzeń: dimming, hover reveal, fokus, kliknięcie poniżej progu, prawy przycisk, drop grupy na drugą stronę, reorder elementu i odrzucenie dropu w treści głównej.
12. Zweryfikować urządzenie mobilne, przewijanie dotykiem, jasny/ciemny motyw, `focus-visible`, uchwyt minimum 44 px i brak poziomego przepełnienia w testach komponentowych i przeglądarkowych.
13. Uruchomić gate repozytorium: `npm run typecheck`, `npm test`, `npm run test:unit`, `npm run build`, `npm run test:package`; opisać ewentualne niezwiązane awarie.

## 📋 Kryteria akceptacji

- [ ] W trybie edycji użytkownik może przeciągnąć widget na inną pozycję wśród elementów tego samego rodzica.
- [ ] Cały widok jest wyszarzony w trybie edycji, a hover przywraca pełny kolor wskazanego elementu.
- [ ] Grupa jest przenoszona jako całość, ale pojedyncze dziecko można wyrwać i przenieść osobno.
- [ ] Cała grupa może zostać przeniesiona na drugą stronę razem z zawartością.
- [ ] Cały blok z czerwonej ramki jest przenoszony jako jedna sekcja: logo/repo, New task, nawigacja, zakładki, empty state i toolbar.
- [ ] Elementy można reorderować dopiero wewnątrz całego przeniesionego bloku, niezależnie od jego strony.
- [ ] Główna część treści nie jest powierzchnią dropu dla grup ani elementów.
- [ ] Symbol miejsca docelowego lub wskaźnik upuszczenia pokazuje dokładny cel podczas przeciągania.
- [ ] Kliknięcie bez przekroczenia progu nie rozpoczyna przeciągania i nie zmienia kolejności.
- [ ] Najechanie i fokus pokazują informację o elemencie, ale nie zmieniają layoutu.
- [ ] Prawy przycisk nie rozpoczyna przeciągania ani nie zmienia kolejności.
- [ ] Escape, `pointercancel` i nieprawidłowe upuszczenie przywracają stan początkowy.
- [ ] Przeciąganie klawiaturą jest możliwe z uchwytu i ma komunikat w regionie live.
- [ ] Istniejący guard interakcji nadal blokuje biznesowe kliknięcia, wysłanie formularza i dropdowny; uchwyt edytora jest jawnie dozwolony.
- [ ] Tryb normalny nie ma uchwytów, placeholderów ani zmiany zachowania istniejących widgetów.
- [ ] Nie dodano API, persystencji, resize, usuwania, parentowania przez drop ani nowej zależności.
