# Przesuwanie elementów w layoucie

## 📋 Skrót

Dodajemy możliwość zmiany kolejności elementów zarejestrowanych w layoucie podczas aktywnego globalnego trybu edycji. Użytkownik rozpoczyna przeciąganie po przekroczeniu małego progu ruchu, widzi jednoznaczny symbol miejsca docelowego, a po puszczeniu element zostaje przeniesiony do nowej pozycji w obrębie tego samego rodzica. Zwykłe najechanie, fokus, kliknięcie i prawy przycisk myszy zachowują odrębne znaczenie i nie mogą przypadkowo uruchamiać przeciągania.

Faza nie dodaje zapisu layoutu, resize, usuwania, przenoszenia między kontenerami ani API. Zmiana jest lokalnym stanem klienta przygotowanym do późniejszej persystencji.

## 📋 Rozstrzygnięte założenia (domyślne decyzje autonomiczne)

| # | Pytanie | Zastosowane założenie | Uzasadnienie | Potwierdzenie? |
|---|---|---|---|---|
| Q1 | Czy ta specyfikacja obejmuje także zmianę rodzica elementu, np. przeniesienie widgetu do innej grupy? | Nie; v1 pozwala zmieniać kolejność rodzeństwa w jednym kontenerze. | To najmniejszy model, który dostarcza realne reorderowanie i nie wymaga reguł kompatybilności typów grup ani geometrii wielokontenerowej. | ok |
| Q2 | Czy zmiana ma być zapisywana po odświeżeniu lub przez API? | Nie; kolejność żyje w pamięci do czasu kolejnego przeładowania. | Discovery i globalny tryb edycji nie mają jeszcze kontraktu persystencji; dodanie storage/API byłoby osobną zdolnością o większym zakresie ryzyka. | tak |
| Q3 | Czy grupa jest przeciągana razem z całym poddrzewem? | Tak, grupa jest jednym elementem sortowalnym, a dzieci pozostają wewnątrz niej. | Użytkownik nie powinien przypadkowo rozrywać hierarchii; model rejestru już rozróżnia grupę i poddrzewo. | ok |
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

Bez tej granicy pojedynczy pointerdown może jednocześnie wybrać widget, kliknięcie może wykonać jego akcję, a przypadkowe kilka pikseli ruchu może zmienić layout.

## 📋 Proponowane rozwiązanie

W trybie edycji każdy zarejestrowany element sortowalny otrzymuje mały, jawny uchwyt przeciągania. `DndContext` i `SortableContext` obsługują tylko powierzchnię layoutu, a `useSortable` jest podłączony do uchwytu, nie do całego widgetu. Aktywacja wskaźnika następuje dopiero po przekroczeniu progu około 6 px; zwykłe kliknięcie pozostaje kliknięciem.

Podczas przeciągania:

1. element źródłowy przechodzi w stan `dragging`, a jego wizualna kopia jest renderowana w `DragOverlay`;
2. elementy rodzeństwa pozostają w układzie, ale między nimi pojawia się jedna linia lub strefa upuszczenia opisująca dokładne miejsce wstawienia;
3. `over` aktualizuje wyłącznie kandydatkę pozycji, bez wywoływania akcji biznesowych i bez zapisu;
4. `dragEnd` zamienia kolejność identyfikatorów rodzeństwa w rejestrze lub warstwie layoutu; upuszczenie na źródle lub poza dozwolonym kontenerem niczego nie zmienia;
5. `dragCancel`, `pointercancel` lub utrata aktywnego celu przywraca poprzednią kolejność.

W v1 element może zostać wstawiony przed lub za rodzeństwem w tym samym rodzicu. Grupa porusza się jako jeden wpis, a jej `children` i ich wewnętrzna kolejność nie zmieniają się. Nie pokazujemy fałszywego miejsca upuszczenia dla elementu z innego rodzica.

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
- nowy komponent, np. `packages/web/src/components/layout-sortable-surface.tsx` — jedna granica `DndContext`, sensory, `onDragStart/Over/End/Cancel`, kopia elementu i symbol miejsca docelowego.
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
  targetId: string | null // null = koniec tego samego kontenera
  position: 'before' | 'after'
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
- **Hover:** pojawia się subtelny obrys lub uchwyt, ale layout i akcje pozostają bez zmian.
- **Focus:** uchwyt ma widoczny `focus-visible`; fokus nie rozpoczyna przeciągania.
- **Pressed/arming:** po pointerdown uchwyt może pokazać stan pressed, ale do przekroczenia progu nie ma placeholdera ani zmiany kolejności.
- **Dragging:** źródło zachowuje miejsce w układzie jako półprzezroczysta strefa, kopia elementu podąża za wskaźnikiem, a aktywne miejsce upuszczenia ma kontrastowy obrys i oznaczenie.
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

Na komputerze symbol miejsca docelowego ma szerokość i kształt elementu, a kopia jest ograniczona do powierzchni layoutu. Na urządzeniu mobilnym uchwyt pozostaje minimum 44×44 px, a strefa jest widoczna również przy wąskiej kolumnie. Grupa jest przeciągana jako karta lub strefa grupy; jej dzieci nie stają się osobnymi celami dla bieżącego przeciągania.

Makieta: `assets/przesuwanie-elementow/mockup-01-dragging-widget.html` oraz wyrenderowany PNG obok niej.

## 📋 Przypadki brzegowe i scenariusze awarii

- Upuszczenie poza kontenerem, na własny element lub na element z innym rodzicem: brak zmiany, bez wyjątku dla użytkownika.
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

### Faza 2 — Powierzchnia przeciągania wskaźnikiem i dotykiem

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
7. Dodać `DragOverlay`, symbol miejsca docelowego i wskaźnik upuszczenia przed lub za rodzeństwem; test renderuje aktywny stan i prawidłowy cel.
8. Zatwierdzić zmianę kolejności wyłącznie w `onDragEnd`; test potwierdza, że `onDragOver` nie zmienia rejestru, a anulowanie lub nieprawidłowe upuszczenie przywraca stan.
9. Obsłużyć grupę jako pojedynczy wpis sortowalny; test potwierdza niezmienność kolejności i parentId dzieci.

### Faza 3 — Klawiatura, guard i regresje UX

10. Dodać współrzędne klawiatury, Spację/strzałki/Escape i `aria-live`; testy sprawdzają podniesienie, przesunięcie, zatwierdzenie i anulowanie bez aktywacji biznesowej akcji.
11. Dodać macierz zdarzeń: najechanie i fokus niczego nie zmieniają, kliknięcie poniżej progu niczego nie zmienia, prawy przycisk nie uzbraja przeciągania, a przeciąganie po uchwycie zmienia kolejność dopiero po upuszczeniu.
12. Zweryfikować urządzenie mobilne, przewijanie dotykiem, jasny/ciemny motyw, `focus-visible`, uchwyt minimum 44 px i brak poziomego przepełnienia w testach komponentowych i przeglądarkowych.
13. Uruchomić gate repozytorium: `npm run typecheck`, `npm test`, `npm run test:unit`, `npm run build`, `npm run test:package`; opisać ewentualne niezwiązane awarie.

## 📋 Kryteria akceptacji

- [ ] W trybie edycji użytkownik może przeciągnąć widget na inną pozycję wśród elementów tego samego rodzica.
- [ ] Grupa jest przenoszona jako całość; dzieci nie zmieniają rodzica ani wewnętrznej kolejności.
- [ ] Symbol miejsca docelowego lub wskaźnik upuszczenia pokazuje dokładny cel podczas przeciągania.
- [ ] Kliknięcie bez przekroczenia progu nie rozpoczyna przeciągania i nie zmienia kolejności.
- [ ] Najechanie i fokus pokazują informację o elemencie, ale nie zmieniają layoutu.
- [ ] Prawy przycisk nie rozpoczyna przeciągania ani nie zmienia kolejności.
- [ ] Escape, `pointercancel` i nieprawidłowe upuszczenie przywracają stan początkowy.
- [ ] Przeciąganie klawiaturą jest możliwe z uchwytu i ma komunikat w regionie live.
- [ ] Istniejący guard interakcji nadal blokuje biznesowe kliknięcia, wysłanie formularza i dropdowny; uchwyt edytora jest jawnie dozwolony.
- [ ] Tryb normalny nie ma uchwytów, placeholderów ani zmiany zachowania istniejących widgetów.
- [ ] Nie dodano API, persystencji, resize, usuwania, przenoszenia między rodzicami ani nowej zależności.
