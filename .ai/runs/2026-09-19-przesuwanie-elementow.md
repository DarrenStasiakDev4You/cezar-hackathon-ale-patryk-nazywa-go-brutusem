# Implementacja: przesuwanie elementów w layoucie

Goal: dodać lokalne, dostępne reorderowanie zarejestrowanych elementów layoutu w globalnym trybie edycji, bez persystencji, API i przenoszenia między rodzicami.

Scope: `packages/web/src/lib/layout-elements.ts`, komponenty layoutu i sortowalnej powierzchni, istniejący guard edit mode, style oraz testy jednostkowe/komponentowe.

Non-goals: zapis layoutu, HTTP/CLI, rozszerzenia, resize, usuwanie, przenoszenie między rodzicami i nowe zależności.

Source doc: `.ai/specs/2026-09-19-przesuwanie-elementow.md`

## Implementation Plan

### Faza 1: uporządkowany model layoutu

- [ ] 1.1 Zmapować miejsca użycia rejestru, wrappera i edit mode oraz ustalić kontrakt powierzchni sortowania.
- [ ] 1.2 Dodać stabilną kolejność rodzeństwa i `getSiblingIds`, zachowując lifecycle rejestracji.
- [ ] 1.3 Zaimplementować `moveWithinParent` z walidacją rodzica, celu i własnego poddrzewa.
- [ ] 1.4 Zapewnić niemutowalne snapshoty i pojedynczą publikację udanej zmiany.

### Faza 2: przeciąganie wskaźnikiem i dotykiem

- [ ] 2.1 Dodać sortowalną powierzchnię opartą o dnd-kit, aktywną wyłącznie w edit mode.
- [ ] 2.2 Podłączyć jawny uchwyt, sensor dystansu 6 px i atrybut przepuszczający guard.
- [ ] 2.3 Dodać DragOverlay, wskaźnik miejsca docelowego i obsługę celu rodzeństwa.
- [ ] 2.4 Zatwierdzać reorder wyłącznie w `onDragEnd`; anulowanie i błędny cel nie zmieniają rejestru.
- [ ] 2.5 Traktować grupę jako pojedynczy wpis bez zmiany rodziców dzieci.

### Faza 3: klawiatura, guard i regresje UX

- [ ] 3.1 Dodać klawiaturowe współrzędne, Space/strzałki/Escape i region aria-live.
- [ ] 3.2 Pokryć macierz hover/focus/click/contextmenu/drag oraz brak aktywacji biznesowej akcji.
- [ ] 3.3 Zweryfikować mobile, touch scrolling, motywy, focus-visible i uchwyt 44 px.
- [ ] 3.4 Uruchomić pełny gate repozytorium i opisać wyniki.

## Risks

- Największe ryzyko to podłączenie sensora do całej karty zamiast uchwytu; ograniczamy je przez osobny `setActivatorNodeRef` i testy interakcji.
- Kolejność musi mieć jedno źródło prawdy w rejestrze; DOM pozostaje wyłącznie projekcją.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Faza 1: uporządkowany model layoutu

- [ ] 1.1 Zmapować miejsca użycia rejestru, wrappera i edit mode oraz ustalić kontrakt powierzchni sortowania.
- [ ] 1.2 Dodać stabilną kolejność rodzeństwa i `getSiblingIds`, zachowując lifecycle rejestracji.
- [ ] 1.3 Zaimplementować `moveWithinParent` z walidacją rodzica, celu i własnego poddrzewa.
- [ ] 1.4 Zapewnić niemutowalne snapshoty i pojedynczą publikację udanej zmiany.

### Faza 2: przeciąganie wskaźnikiem i dotykiem

- [ ] 2.1 Dodać sortowalną powierzchnię opartą o dnd-kit, aktywną wyłącznie w edit mode.
- [ ] 2.2 Podłączyć jawny uchwyt, sensor dystansu 6 px i atrybut przepuszczający guard.
- [ ] 2.3 Dodać DragOverlay, wskaźnik miejsca docelowego i obsługę celu rodzeństwa.
- [ ] 2.4 Zatwierdzać reorder wyłącznie w `onDragEnd`; anulowanie i błędny cel nie zmieniają rejestru.
- [ ] 2.5 Traktować grupę jako pojedynczy wpis bez zmiany rodziców dzieci.

### Faza 3: klawiatura, guard i regresje UX

- [ ] 3.1 Dodać klawiaturowe współrzędne, Space/strzałki/Escape i region aria-live.
- [ ] 3.2 Pokryć macierz hover/focus/click/contextmenu/drag oraz brak aktywacji biznesowej akcji.
- [ ] 3.3 Zweryfikować mobile, touch scrolling, motywy, focus-visible i uchwyt 44 px.
- [ ] 3.4 Uruchomić pełny gate repozytorium i opisać wyniki.
