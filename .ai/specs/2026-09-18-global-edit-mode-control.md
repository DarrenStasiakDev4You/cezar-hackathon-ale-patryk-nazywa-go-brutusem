# Globalna kontrolka trybu edycji

## 📋 TLDR

Należy dodać do globalnego shellu kokpitu React kontrolkę trybu edycji layoutu. Niezależna ikona wizualnie kojarząca się z edycją układu, z napisem „Edit mode”, ma być zawsze widoczna nad treścią routowanych widoków. Kliknięcie aktywuje tryb edycji i pokazuje jaskrawy, czytelny pasek statusu z przyciskiem „Exit edit mode” — bez otwierania modala. Po aktywacji cała treść jest domyślnie lekko wyszarzona; najechanie kursorem lub uzyskanie fokusu przez dowolny element przywraca mu jego pierwotny kolor i wygląd. Kontrolka musi mieć własną przestrzeń wizualną, aby żadna treść nie mogła jej zasłonić; elementy kolidujące z jej obszarem należy automatycznie przesunąć w lewo.

## 📋 Problem

Kokpit nie ma obecnie stałego i łatwego do znalezienia wejścia do trybu edycji. Użytkownik potrzebuje wyraźnej kontrolki w miejscu wskazanym przez czerwony okrąg, jasnego potwierdzenia aktywacji oraz stale dostępnego sposobu wyłączenia trybu.

Kontrolka jest globalna, a nie przypisana do konkretnej strony: musi pozostać widoczna podczas nawigacji i nie może stać się częścią routowanego widoku ani zostać przykryta przez jego elementy. Układ musi również mieć jednoznaczną zasadę rozwiązywania kolizji, szczególnie na małych ekranach oraz przy stałych lub przyklejonych elementach interfejsu.

## 📋 Proponowane rozwiązanie

Należy dodać prezentacyjny komponent `EditModeControl` montowany przez globalny shell aplikacji, poza routowaną treścią i kontenerami stron. Kontrolka składa się z:

1. Ikony adekwatnej do edycji layoutu, umieszczonej w stałej warstwie, z widocznym napisem „Edit mode” po prawej stronie.
2. Stałego, jaskrawego paska u góry ekranu widocznego podczas aktywnego trybu edycji. Pasek zawiera tekst „You are in edit mode” oraz przycisk „Exit edit mode”.
3. Globalnego stanu wizualnego trybu edycji: nieaktywny UI jest lekko wyszarzony, a element pod hoverem lub fokusem odzyskuje pierwotny kolor i wygląd.

Pierwsza wersja odpowiada wyłącznie za stan trybu i jego oprawę. Nie określa jeszcze, które elementy stron są edytowalne, nie zapisuje trybu po przeładowaniu i nie dodaje kontraktu serwerowego. Te kwestie mogą zostać opisane w osobnej specyfikacji.

### Rozważone alternatywy

- Kontrolka przypisana do strony została odrzucona, ponieważ mogłaby znikać podczas nawigacji.
- Sama ikona bez tekstu została odrzucona, ponieważ użytkownik wymaga napisu „Edit mode”, a para ikona + tekst poprawia wykrywalność funkcji.
- Modal został odrzucony: wejście w tryb ma być natychmiastowe i nie może przerywać pracy użytkownika dodatkowym oknem.
- Przezroczysta nakładka bez rezerwacji miejsca została odrzucona, ponieważ nie gwarantuje, że niezależna ikona nigdy nie zostanie zasłonięta.

## Założenia rozstrzygnięte automatycznie

| Pytanie | Przyjęta odpowiedź | Uzasadnienie |
| --- | --- | --- |
| Q1. Gdzie zamontować kontrolkę? | W globalnym shellu React, poza routowanymi widokami. | To najmniejszy zakres gwarantujący trwałość podczas nawigacji i niezależność od treści stron. |
| Q2. Czy tryb ma być zachowany po przeładowaniu lub zmianie projektu? | Nie; w wersji 1 stan pozostaje w pamięci Reacta. | Unikamy nowego kontraktu storage/API przed zdefiniowaniem właściwych edytowalnych elementów. |
| Q3. Co poza oprawą ma zmieniać aktywacja? | Stały pasek oraz globalne wyszarzenie UI z przywracaniem wyglądu elementu pod hoverem/fokusem. | To bezpośrednio komunikuje tryb edycji bez modala; właściwe zapisywanie edycji pozostaje poza zakresem. |
| Q4. Jak unikać kolizji? | Shell rezerwuje responsywny obszar bezpieczeństwa, utrzymuje kontrolkę nad treścią, a elementy kolidujące przesuwa w lewo. | Jest to rozwiązanie lokalne, odwracalne i bezpośrednio spełnia wymaganie widoczności. |
| Q5. Co oznacza „jaskrawy” w istniejącym systemie? | Istniejący jasny token statusu/akcentu albo kontrastowa powierzchnia amber/yellow z czytelnym ciemnym tekstem. | Rozwiązanie korzysta z tokenów repozytorium i nie wprowadza surowych kolorów ani nieczytelnego neonu. |

## 📋 Architektura

### Granica komponentu

- Dodać komponent shellu w `packages/web/src/components/`.
- Zamontować go dokładnie raz w `AppShell`, obok sidebara i głównego layoutu.
- Ponownie użyć istniejącego komponentu `Button` i istniejących tokenów UI; modal nie jest potrzebny.
- Wybrać ikonę z `lucide-react` kojarzącą się z edycją layoutu, np. `PanelsTopLeftIcon`, `LayoutDashboardIcon` albo `PencilRulerIcon`. Ostateczny wybór powinien najlepiej komunikować zmianę układu, a nie ustawienia aplikacji.
- Zapewnić dostępną nazwę także wtedy, gdy tekst zostanie ograniczony na małym ekranie.

### Stan i przepływ danych

```text
kliknięcie ikony → enabled = true + wyszarzenie UI
                              ↓
                   stały pasek trybu edycji
                              ↓
              Exit edit mode → enabled = false
```

Wielokrotne kliknięcie aktywnej kontrolki jest idempotentne i nie może tworzyć wielu pasków ani zmieniać stanu elementów.

### Kontrakt warstw i kolizji

- Kontrolka otrzymuje własną stałą warstwę nad treścią routowaną i paskiem.
- Obszar kliknięcia obejmuje ikonę i tekst, ale kontrolka nie może być zagnieżdżona w karcie, toolbarze, linku ani overlayu strony.
- Shell rezerwuje poziomą przestrzeń dla kontrolki przy krawędzi ekranu. Przy szerokości, która nie pozwala wygodnie wyświetlić tekstu, można użyć kompaktowego układu, ale ikona musi pozostać widoczna, a nazwa dostępna.
- Aktywny pasek musi zajmować osobny wiersz layoutu lub równoważną zarezerwowaną przestrzeń, a nie nakładać się na sticky header strony.
- Zarezerwowana przestrzeń musi uwzględniać safe-area inset i nie może powodować poziomego overflow.

## 📋 Model danych

Nie dodajemy danych trwałych, stanu serwera, endpointu API, migracji ani konfiguracji. W wersji 1 tryb jest lokalnym booleanem w komponencie React należącym do shellu.

## 📋 Kontrakty API

Brak. Jest to stan wyłącznie kliencki; funkcja nie dodaje endpointu HTTP, schematu kontraktu, zdarzenia SSE, topicu WebSocket ani klucza storage.

## 📋 UI/UX

### Stan nieaktywny

- Ikona adekwatna do edycji layoutu jest widoczna w miejscu wskazanym przez czerwony okrąg; nie może być ikoną koła zębatego/settings.
- Po jej prawej stronie widoczny jest dokładny napis „Edit mode”.
- Kontrolka jest niezależna od sąsiedniej treści i ma widoczny stan focus-visible.
- Ikona i tekst tworzą jeden obszar aktywacji o minimalnym rozmiarze 44 px na urządzeniach mobilnych.

### Włączanie trybu

1. Użytkownik aktywuje kontrolkę.
2. Tryb edycji zostaje aktywowany natychmiast; nie otwiera się modal ani inne okno blokujące.
3. Cała treść interfejsu zostaje lekko wyszarzona.
4. U góry pojawia się stały pasek z tekstem „You are in edit mode” oraz przyciskiem „Exit edit mode”.

### Stan aktywny i wyjście

- Kontrolka pozostaje widoczna i wystawia `aria-pressed="true"` albo równoważny stan.
- Pasek używa jaskrawego, ale dostępnego kontrastowo tła i tekstu w jasnym oraz ciemnym motywie.
- W trybie edycji elementy UI otrzymują delikatny efekt wyszarzenia, ale pozostają czytelne i używalne.
- Element znajdujący się pod kursorem albo aktualnie skupiony klawiaturą odzyskuje swój pierwotny kolor, kontrast i wygląd; przejście nie może powodować skakania layoutu.
- „Exit edit mode” usuwa pasek, przywraca nieaktywny wygląd kontrolki i nie powoduje nawigacji ani przeładowania.
- Użytkownicy z ograniczeniem animacji nie mogą otrzymywać istotnej informacji wyłącznie przez animację.

### Responsywność

- Desktop: kontrolka znajduje się przy wskazanej krawędzi ekranu, etykieta jest widoczna, a shell rezerwuje miejsce zapobiegające kolizji.
- Mobile: kontrolka pozostaje niezależna i dostępna; jeśli tekst musi zostać zwinięty, nazwa dostępnościowa oraz tooltip/title zachowują znaczenie.
- Sticky headers, drawers, dialogi, toasty i treść stron nie mogą zasłaniać kontrolki. Kontrolka nie może zasłaniać elementów aktywnych bez przesunięcia ich do zarezerwowanego obszaru.

### Dostępność

- Użytkownik klawiatury może osiągnąć i aktywować kontrolkę oraz przycisk wyjścia w logicznej kolejności.
- Aktywny pasek używa niedrażniącego ogłoszenia statusu, np. `role="status"`, i nie ogłasza się ponownie przy każdym renderze.
- Wariant ikonowy nadal ma dostępną nazwę i tooltip.
- Kontrast, widoczność fokusu i rozmiar celu korzystają z istniejących konwencji UI.

## 📋 Przypadki brzegowe i awarie

- Wielokrotna szybka aktywacja nie otwiera żadnych modali ani nie duplikuje pasków.
- Wejście w tryb nie otwiera modala i nie blokuje interakcji.
- Wyłączenie trybu usuwa wyszarzenie i pasek; wyłącza go wyłącznie „Exit edit mode”.
- Nawigacja między trasami zachowuje pasek i kontrolkę, ponieważ oba elementy należą do shellu.
- Wąski viewport nie może obcinać ikony, etykiety ani przycisku wyjścia.
- Strona ze stałym lub sticky elementem u góry zaczyna się poniżej aktywnego paska.
- Treść w miejscu kontrolki jest przesuwana w lewo lub do zarezerwowanej strefy.
- Zmiana motywu podczas aktywnego trybu zachowuje czytelny kontrast.

## 📋 Ryzyka i wpływ

- **Wpływ na layout:** Globalna kontrolka i pasek dotykają każdej trasy. Zmiany należy ograniczyć do `AppShell` i sprawdzić dla wariantu jedno- oraz wieloprojektowego.
- **Stacking context:** `transform`, `overflow` i zagnieżdżone z-indexy mogą zaburzyć fixed positioning. Należy zweryfikować rzeczywistą kolejność warstw.
- **Dostępność:** Jaskrawe kolory i wyszarzenie mogą obniżyć kontrast. Należy sprawdzić kombinacje tokenów w obu motywach oraz zapewnić pełny kontrast elementu pod fokusem.
- **Rozrost zakresu:** Nie implementować edycji elementów, drag-and-drop ani zapisu ustawienia w tej specyfikacji.
- **Wycofanie:** Usunięcie komponentu i jego montowania przywraca poprzednie zachowanie bez migracji danych.

## 📚 Notatki z researchu

Otwarte edytory wizualne zwykle pokazują tryb edycji jawnie i trwale, zamiast ukrywać go za chwilowym powiadomieniem. Design Mode używa stałej kontrolki dla powierzchni projektowania na żywo, a OpenPage łączy edycję z widoczną powierzchnią edytora. Wytyczne GitHub Primer dotyczące progressive disclosure zalecają także łączenie ikon z tekstem, gdy działanie wymaga łatwego znalezienia. Wspiera to kontrolkę „ikona + Edit mode” oraz stały pasek, przy zachowaniu mniejszego zakresu niż pełny edytor wizualny.

- [Design Mode](https://github.com/SandeepBaskaran/design-mode)
- [OpenPage](https://github.com/buildingopen/openpage)
- [GitHub Primer — Progressive disclosure](https://primer.github.io/design/ui-patterns/progressive-disclosure/)

## 📋 Etapy

### Faza 1 — Kontrolka shellu i cykl życia trybu

Wdrożyć niezależną kontrolkę, lokalny stan aktywny, globalne wyszarzenie UI, stały pasek, przycisk wyjścia, responsywną rezerwację miejsca i dostępność.

### Faza 2 — Integracja z edytowalnymi elementami

Osobna specyfikacja określi, które elementy kokpitu są edytowalne, jak zapisywać zmiany, jak obsługiwać uprawnienia i co robić z niezapisanymi zmianami.

## 📋 Plan implementacji

1. Dodać komponent trybu edycji należący do shellu, wykorzystując istniejące prymitywy button, ikon, tokenów i dostępności; bez dialogu, API i persystencji.
2. Zaimplementować stany nieaktywny, aktywny i wyjścia z dokładnymi angielskimi etykietami oraz idempotentnymi przejściami; dodać testy komponentu.
3. Dodać globalne lekkie wyszarzenie UI oraz regułę przywracania pierwotnego koloru i wyglądu elementu pod hoverem/fokusem.
4. Dodać rezerwację miejsca i kontrakt warstw dla desktopu, mobile, safe-area, sticky headerów i kolizji treści.
5. Zweryfikować jasny/ciemny motyw, klawiaturę, reduced motion, rozmiary celów dotykowych, kontrast oraz brak skakania layoutu.
5. Zaktualizować dokumentację UI tylko wtedy, gdy repozytorium wymaga wpisu w katalogu komponentów; nie dodawać zmian API ani wpisu kompatybilności.

## 📋 Kryteria akceptacji

- [ ] Ikona adekwatna do edycji layoutu, inna niż koło zębate/settings, jest widoczna w miejscu czerwonego okręgu i ma po prawej stronie napis „Edit mode”.
- [ ] Kontrolka jest niezależnym elementem shellu i nigdy nie jest zasłonięta przez treść, overlay, sticky header ani drawer.
- [ ] Treść kolidująca z obszarem kontrolki jest automatycznie przesuwana w lewo.
- [ ] Aktywacja kontrolki natychmiast włącza tryb edycji i nie otwiera żadnego modala.
- [ ] Po wejściu w tryb cała treść UI jest domyślnie lekko wyszarzona.
- [ ] Element pod hoverem lub fokusem odzyskuje swój pierwotny kolor, kontrast i wygląd.
- [ ] Podczas aktywnego trybu u góry widoczny jest jaskrawy, czytelny pasek z tekstem „You are in edit mode”.
- [ ] Pasek ma angielski przycisk „Exit edit mode”, który wyłącza tryb bez nawigacji i przeładowania.
- [ ] Kontrolka i pasek działają w jasnym/ciemnym motywie oraz na urządzeniach mobilnych.
- [ ] Fokus klawiatury, nazwy dostępnościowe, rozmiary celów, kontrast, hover/focus reveal i reduced motion są pokryte testami lub weryfikacją przeglądarkową.
- [ ] Nie dodano endpointu API, ustawienia trwałego, schematu, migracji ani zewnętrznej zależności.
