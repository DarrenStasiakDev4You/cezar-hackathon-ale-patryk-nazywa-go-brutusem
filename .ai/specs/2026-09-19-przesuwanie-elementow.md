# Przesuwanie elementów w layoucie

## 📋 Skrót

Dodajemy wizualny edytor layoutu w faktycznym cockpitcie Cezara, uruchamiany przez globalny tryb edycji. Cały widok — poza aktywnie wskazanym elementem — jest wtedy wyszarzony, aby użytkownik widział, że edytuje strukturę, a nie uruchamia funkcje biznesowe. Hover przywraca pełny kolor wskazanego elementu.

Użytkownik może przeciągnąć grupę razem z poddrzewem, dowolny element niezależnie od jego pierwotnej grupy, element do dowolnej grupy oraz jeden element na drugi. W ostatnim przypadku upuszczony element staje się dzieckiem celu, a cel jego parentem. Podczas dragowania widoczny jest jednoznaczny placeholder, a po puszczeniu struktura i pozycja są aktualizowane lokalnie.

## 📋 Rozstrzygnięte założenia (domyślne decyzje autonomiczne)

| # | Pytanie | Zastosowane założenie | Uzasadnienie | Potwierdzenie? |
|---|---|---|---|---|
| Q1 | Czy można zmienić rodzica elementu i upuścić go na inny element? | Tak; drop na grupie dodaje dziecko, a drop na elemencie ustawia ten element jako parenta. | Jest to główny cel tej iteracji, a nie opcjonalne rozszerzenie reorderowania. | ⚠ NEEDS HUMAN CONFIRMATION |
| Q2 | Czy zmiana ma być zapisywana po odświeżeniu lub przez API? | Nie; kolejność żyje w pamięci do czasu kolejnego przeładowania. | Discovery i globalny tryb edycji nie mają jeszcze kontraktu persystencji; dodanie storage/API byłoby osobną zdolnością o większym zakresie ryzyka. | tak |
| Q3 | Czy grupa jest przeciągana razem z całym poddrzewem? | Tak; grupa jest jednym uchwytem, a całe poddrzewo porusza się razem. Pojedyncze dziecko można jednak wyrwać i przenieść osobno. | Łączy szybkie przenoszenie grup z pełną swobodą edycji pojedynczego elementu. | ⚠ NEEDS HUMAN CONFIRMATION |
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

W trybie edycji każdy zarejestrowany element otrzymuje jawny uchwyt i strefy drop. Cały aktywny widok dostaje warstwę dimmingu; element pod hoverem oraz element dragowany odzyskują pełny kolor. `DndContext` obejmuje również strefy grup i elementów, a `useSortable` pozostaje podłączony do uchwytu, nie do dowolnych kontrolek wewnątrz widgetu. Aktywacja wskaźnika następuje dopiero po przekroczeniu progu około 6 px.

Podczas przeciągania:

1. element źródłowy przechodzi w stan `dragging`, a jego wizualna kopia jest renderowana w `DragOverlay`;
2. elementy rodzeństwa pozostają w układzie, ale między nimi pojawia się jedna linia lub strefa upuszczenia opisująca dokładne miejsce wstawienia;
3. `over` aktualizuje wyłącznie kandydatkę pozycji, bez wywoływania akcji biznesowych i bez zapisu;
4. `dragEnd` rozstrzyga cel: drop w szczelinie zmienia kolejność, drop na grupie dodaje dziecko, a drop na elemencie ustawia go jako parenta; placeholder pokazuje wybrany wariant przed zatwierdzeniem;
5. `dragCancel`, `pointercancel` lub utrata aktywnego celu przywraca poprzednią kolejność.

Element może zostać wstawiony przed lub za rodzeństwem, do dowolnej grupy albo na dowolny element. Grupa porusza się jako jeden wpis z poddrzewem, ale dziecko można przeciągnąć poza grupę. Nie wolno przenieść elementu do własnego poddrzewa.

### Wnioski z analizy i odrzucone alternatywy

- Istniejący kreator workflow potwierdza wzorzec: `PointerSensor` z małym dystansem aktywacji, `DragOverlay`, `SortableContext` oraz `sortableKeyboardCoordinates`. Ten wzorzec rozdziela kliknięcie od przeciągania i ma już testy w repozytorium.
- `react-grid-layout` modeluje układ jako stabilne identyfikatory i osobne pozycje, z placeholderem oraz strategiami kolizji, ale wprowadza cięższy model współrzędnych, resize i compaction. Dla v1 reorderowania rodzeństwa byłoby to przedwczesne ([README](https://github.com/react-grid-layout/react-grid-layout)).
- Własna globalna maszyna stanów zdarzeń wskaźnika została odrzucona: dublowałaby istniejący prymityw dnd-kit i zwiększała ryzyko rozjazdu między myszą, dotykiem i klawiaturą.
- HTML5 `draggable` został odrzucony dla tej powierzchni: repozytorium używa go tylko dla prostych starszych przepływów, a tutaj potrzebujemy jednolitej kopii elementu, progu aktywacji, dotyku i klawiatury.

## 📋 Architektura

### Moduły i odpowiedzialności

- `packages/web/src/lib/layout-elements.ts` — dodać jawny, niemutujący model kolejności rodzeństwa oraz operację `moveBefore`/`moveAfter` z walidacją tego samego `parentId`.
- `packages/web/src/components/layout-registry.tsx` — udostępnić kolejność i stabilne aktualizacje dla jednego layoutu; dostawca kontekstu pozostaje właścicielem instancji.
- `packages/web/src/components/layout-element.tsx` — zachować deklaratywny wrapper i dodać semantyczny uchwyt lub strefę tylko wtedy, gdy aktywny jest tryb edycji.
- nowy komponent, np. `packages/web/src/components/layout-sortable-surface.tsx` — jedna granica `DndContext`, sensory, dimming, hover reveal, `onDragStart/Over/End/Cancel`, kopia elementu i strefy drop dla reorderu oraz parentingu.
- `packages/web/src/components/app-shell.tsx` — bez nowej polityki per-widget; istniejący guard nadal blokuje kliknięcie/wysłanie formularza i przepuszcza wyłącznie jawne akcje edytora.
- `packages/web/src/styles/index.css` — stany `hover`, `focus-visible`, `dragging` i wskaźnika miejsca upuszczenia bez zmiany wymiarów elementu poza przeznaczoną przestrzenią symbolu miejsca docelowego.

### Przepływ stanu

1. Powierzchnia sortowania odczytuje snapshot rejestru i grupuje elementy po `parentId`.
2. `useSortable` zna wyłącznie `id`, `parentId` i pozycję w rodzeństwie; nie czyta ani nie zapisuje danych domenowych widgetu.
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

Obecny descriptor zostaje rozszerzony o kolejność wyliczaną z tablicy wpisów layoutu, bez zmiany `id`, `kind` i `parentId`:

```ts
type LayoutPlacement = {
  id: string
  parentId?: string
  order: number
}

type LayoutMove = {
  id: string
  targetId: string | null // null = koniec wybranego kontenera
  position: 'before' | 'after' | 'inside'
}
```

`order` jest lokalny dla jednego `parentId` i nie jest pozycją CSS ani współrzędną. Źródłem prawdy ma być jedna uporządkowana kolekcja; `children` w snapshotach pozostaje projekcją, aby nie utrzymywać dwóch niezależnych kolejności.

Stan jest tylko w pamięci. Nie dodajemy localStorage, migracji, serwerowego payloadu, endpointu, SSE/WebSocket ani zmian w `extension-api`. Przyszła persystencja powinna dostać osobny kontrakt, który zapisuje pełny, walidowany layout, a nie pojedyncze zdarzenia wskaźnika.

## 📋 Kontrakty API

Brak zmian HTTP, CLI i kontraktów pakietowych. Wewnętrzny kontrakt klienta powinien wystawić czyste operacje:

```ts
type LayoutRegistry = {
  getSnapshot(): RegisteredLayoutElement[]
  moveWithinParent(move: LayoutMove): boolean
  getSiblingIds(parentId?: string): string[]
}
```

`moveWithinParent` zwraca `false` dla nieznanego źródła/celu, innego rodzica, próby przeniesienia do własnego poddrzewa lub braku zmiany. Operacja nie mutuje argumentów i nie emituje częściowego snapshotu. Nie wolno realizować reorderu przez zmianę DOM lub skanowanie dokumentu.

## 📋 Interfejs i doświadczenie użytkownika

### Stany elementu

- **Normalny:** element zachowuje dotychczasowy wygląd.
- **Edit idle:** cały widok jest wyszarzony; struktura jest czytelna, ale akcje biznesowe są wizualnie wyciszone.
- **Hover:** wskazany element odzyskuje pełny kolor i dostaje subtelny obrys/uchwyt; hover nie zmienia struktury.
- **Focus:** uchwyt ma widoczny `focus-visible`; fokus nie rozpoczyna przeciągania.
- **Pressed/arming:** po pointerdown uchwyt może pokazać stan pressed, ale do przekroczenia progu nie ma placeholdera ani zmiany kolejności.
- **Dragging:** źródło zachowuje miejsce jako półprzezroczysta strefa, kopia podąża za wskaźnikiem, a aktywne miejsce upuszczenia mówi „przenieś tutaj”, „dodaj do grupy” albo „ustaw jako element nadrzędny”.
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

Makieta odtwarza rzeczywisty pusty ekran Cezara, a nie przykładowy dashboard: sidebar z Tasks/Git/GitHub/Automations/Skills/Workflows/Settings, dolny toolbar, nagłówek Tasks, Active/Archived, wyszukiwarkę i centralny empty state. Na komputerze strefa drop ma szerokość elementu; na urządzeniu mobilnym uchwyt ma minimum 44×44 px. Grupa jest przeciągana jako całość, lecz jej dzieci nadal są osobnymi celami, gdy użytkownik rozpocznie drag bezpośrednio na dziecku.

Makieta: `assets/przesuwanie-elementow/mockup-01-dragging-widget.html` oraz wyrenderowany PNG obok niej.

## 📋 Przypadki brzegowe i scenariusze awarii

- Upuszczenie poza kontenerem, na własny element albo do własnego poddrzewa: brak zmiany, bez wyjątku dla użytkownika.
- Upuszczenie elementu na grupę: element otrzymuje `parentId` grupy i zostaje dodany na jej końcu albo w pokazanej strefie.
- Upuszczenie elementu na inny element: cel staje się parentem źródła, a źródło zostaje wyrenderowane jako podelement.
- Drop dziecka poza dotychczasową grupę zachowuje jego tożsamość i przenosi tylko jego gałąź, nie całą grupę.
- Upuszczenie na własny symbol miejsca docelowego: nic nie zmieniać; nie tworzyć duplikatu ani pustej strefy.
- Szybkie kliknięcie bez przekroczenia progu: callback przeciągania nie jest wywołany.
- Anulowanie wskaźnika, Escape, zamknięcie kopii lub odmontowanie źródła: przywrócić kolejność początkową i wyczyścić stan aktywnego przeciągania.
- React Strict Mode i ponowne renderowanie w trakcie przeciągania: identyfikator aktywnego elementu pozostaje stabilny; brak podwójnego wpisu i brak wycieku listenerów.
- Dynamiczne zamontowanie/odmontowanie: rejestr odrzuca nieaktualny cel; bieżące przeciąganie kończy się anulowaniem, jeśli źródło znika.
- Zagnieżdżone grupy: zmiana kolejności dotyczy tylko rodzeństwa grupy; nie można wciągnąć elementu do własnego poddrzewa.
- Element z przyciskiem lub linkiem w środku: `pointerdown` poza uchwytem nie uzbraja przeciągania; kliknięcie i prawy przycisk są obsługiwane przez istniejący guard.
- Brak możliwości pomiaru geometrii: symbol miejsca docelowego używa wartości zastępczej z prostokąta źródła, a upuszczenie jest nadal walidowane logicznie.
- Błąd wewnętrznej operacji zmiany kolejności: pozostawić stary snapshot, zakończyć przeciąganie jako anulowane i nie pokazywać układu częściowo zmienionego.

## 📋 Przegląd ryzyka i wpływu

Największe ryzyko to złapanie całej karty zamiast uchwytu, co blokowałoby kliknięcie, fokus i istniejące interakcje. Ograniczają je osobny uchwyt, odległość aktywacji, testy macierzy zdarzeń i brak `pointer-events: none` na powierzchni.

Drugie ryzyko to rozjazd kolejności w rejestrze i DOM. Jedna uporządkowana kolekcja oraz czysta operacja `moveWithinParent` są źródłem prawdy; DOM jest tylko projekcją. Brak persystencji oznacza, że cofnięcie jest natychmiastowe przez Escape/anulowanie, a pełne wycofanie wydania to revert zmian klienta.

Nie ma zmian w danych serwerowych, trasach, auth, configu, rozszerzeniach ani kompatybilności wstecznej. Nie dodajemy zależności, ponieważ dnd-kit już jest zależnością `packages/web`.

## 📋 Fazy wdrożenia

### Faza 1 — Uporządkowany model layoutu

Rozszerzyć rejestr o kolejność rodzeństwa i czyste operacje zmiany kolejności, wraz z walidacją tego samego rodzica i ochroną poddrzewa. Faza kończy się działającym modelem bez interfejsu użytkownika.

### Faza 2 — Powierzchnia przeciągania, dimming i parentowanie

Dodać `DndContext`, sensory, uchwyt, kopię elementu, symbol miejsca docelowego i zatwierdzenie upuszczenia na powierzchni layoutu. Faza kończy się działającym przesuwaniem widgetów i grup w trybie edycji.

### Faza 3 — Klawiatura, guard i regresje UX

Dodać przeciąganie klawiaturą, komunikaty regionu live oraz pełną macierz najechania, fokusu, kliknięcia, prawego przycisku i przeciągania, w tym anulowanie i responsywność. Faza kończy się dowodem testowym i przeglądarkowym.

## 📋 Plan wdrożenia

### Faza 1 — Uporządkowany model layoutu

1. Zmapować wszystkie miejsca użycia `LayoutRegistry`, `LayoutElement` i `editMode`; potwierdzić, że nie powstaje druga lista kolejności. Wynik testowalny: fixture z dwoma widgetami głównymi, widgetami w grupie i zagnieżdżoną grupą.
2. Dodać uporządkowaną kolekcję rodzeństwa oraz `getSiblingIds`; testy zachowują stabilną kolejność po rejestracji, odmontowaniu i Strict Mode.
3. Zaimplementować `moveWithinParent`/`moveBefore`/`moveAfter`; testy obejmują początek, środek, koniec, brak zmiany, innego rodzica i własne poddrzewo.
4. Utrzymać snapshot niemutowalny i publikować dokładnie jedną zmianę po udanym upuszczeniu; test wykrywa brak częściowego stanu.

### Faza 2 — Powierzchnia przeciągania wskaźnikiem i dotykiem

5. Dodać jedną powierzchnię sortowalną z istniejącym dnd-kit; test potwierdza, że widget poza trybem edycji nie ma uchwytu ani aktywnego sensora.
6. Podłączyć uchwyt z odległością aktywacji około 6 px i `data-edit-mode-action="allow"`; test rozróżnia kliknięcie bez ruchu od przeciągania po przekroczeniu progu.
7. Dodać `DragOverlay`, placeholder i trzy typy stref: przed/za rodzeństwem, wewnątrz grupy i na element.
8. Zatwierdzić reorder lub parentowanie wyłącznie w `onDragEnd`; test potwierdza poprawne `parentId`, brak częściowego stanu i anulowanie.
9. Dodać dimming całego widoku oraz hover reveal pełnego koloru; test sprawdza, że hover nieprzeciąganego elementu przywraca jego kontrast.
10. Obsłużyć grupę jako pojedynczy wpis z poddrzewem, ale pozwolić wyrwać pojedyncze dziecko; test potwierdza oba warianty.

### Faza 3 — Klawiatura, guard i regresje UX

11. Dodać współrzędne klawiatury, Spację/strzałki/Escape i `aria-live`; testy obejmują reorder i zmianę parenta bez aktywacji biznesowej akcji.
12. Dodać macierz zdarzeń: dimming, hover reveal, fokus, kliknięcie poniżej progu, prawy przycisk, reorder, drop do grupy i drop na elemencie.
12. Zweryfikować urządzenie mobilne, przewijanie dotykiem, jasny/ciemny motyw, `focus-visible`, uchwyt minimum 44 px i brak poziomego przepełnienia w testach komponentowych i przeglądarkowych.
13. Uruchomić gate repozytorium: `npm run typecheck`, `npm test`, `npm run test:unit`, `npm run build`, `npm run test:package`; opisać ewentualne niezwiązane awarie.

## 📋 Kryteria akceptacji

- [ ] W trybie edycji użytkownik może przeciągnąć widget na inną pozycję wśród elementów tego samego rodzica.
- [ ] Cały widok jest wyszarzony w trybie edycji, a hover przywraca pełny kolor wskazanego elementu.
- [ ] Grupa jest przenoszona jako całość, ale pojedyncze dziecko można wyrwać i przenieść osobno.
- [ ] Element niezależny można przenieść do dowolnej grupy.
- [ ] Drop elementu na drugi element ustawia drugi element jako parenta pierwszego i pokazuje placeholder przed zatwierdzeniem.
- [ ] Symbol miejsca docelowego lub wskaźnik upuszczenia pokazuje dokładny cel podczas przeciągania.
- [ ] Kliknięcie bez przekroczenia progu nie rozpoczyna przeciągania i nie zmienia kolejności.
- [ ] Najechanie i fokus pokazują informację o elemencie, ale nie zmieniają layoutu.
- [ ] Prawy przycisk nie rozpoczyna przeciągania ani nie zmienia kolejności.
- [ ] Escape, `pointercancel` i nieprawidłowe upuszczenie przywracają stan początkowy.
- [ ] Przeciąganie klawiaturą jest możliwe z uchwytu i ma komunikat w regionie live.
- [ ] Istniejący guard interakcji nadal blokuje biznesowe kliknięcia, wysłanie formularza i dropdowny; uchwyt edytora jest jawnie dozwolony.
- [ ] Tryb normalny nie ma uchwytów, placeholderów ani zmiany zachowania istniejących widgetów.
- [ ] Nie dodano API, persystencji, resize, usuwania ani nowej zależności.
