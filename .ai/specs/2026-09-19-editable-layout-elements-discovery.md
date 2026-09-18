# Wykrywanie elementów edytowalnych w layoucie

## 📋 TLDR

Dodajemy klientową warstwę opisującą elementy layoutu, które mogą być wybierane i edytowane w globalnym trybie edycji. Źródłem prawdy będzie typowany, deklaratywny rejestr elementów, a DOM otrzyma równoległe atrybuty `data-*` używane do wskazania i podświetlenia elementu.

Model rozróżni widget, grupę, element należący do grupy oraz grupę zawierającą zagnieżdżone elementy. Ta specyfikacja nie implementuje przesuwania, resize, usuwania, zapisu layoutu ani API; przygotowuje kontrakt dla kolejnych faz edytora.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Czy źródłem ma być rejestr deklaratywny czy skanowanie DOM? | Rejestr deklaratywny jako źródło prawdy; `data-*` jako projekcja DOM. | Hierarchia i przyszłe operacje na poddrzewach wymagają modelu niezależnego od chwilowej struktury HTML. | ok |
| Q2 | Czy zakres kończy się na discovery i hierarchii? | Tak; przesuwanie, resize, usuwanie, zapis i API są poza zakresem. | Najmniejsza niezależnie wdrażalna zdolność, bez przedwczesnej geometrii i persystencji. | ok |
| Q3 | Jaki jest zakres unikalności identyfikatorów? | Jeden rejestr jednej instancji layoutu; identyfikatory są stabilne i nadawane przez autora layoutu. | Nie ma obecnie globalnego kontraktu identyfikatorów layoutu, a lokalny namespace ogranicza sprzężenie. | ok |
| Q4 | Czy grupy mogą zawierać grupy? | Tak, rekurencyjnie; pierwsze UI może pokazać tylko jeden poziom. | Docelowy przypadek obejmuje operacje na całym poddrzewie, więc model nie powinien blokować zagnieżdżeń. | ok |
| Q5 | Gdzie działa warstwa? | Wyłącznie w przyszłym dashboardzie/widgetach; shell, sidebar, nawigacja i ustawienia pozostają poza rejestrem. | Istniejący guard `AppShell` ma globalną odpowiedzialność za blokowanie interakcji, a discovery ma opisywać layout. | ok |

## 📋 Problem Statement

Gałąź `feat/global-edit-mode-interaction-guard` dostarcza globalny stan trybu edycji oraz blokowanie przypadkowych aktywacji biznesowych. `AppShell` rozpoznaje interaktywne elementy DOM i dopuszcza tylko jawnie oznaczone akcje edytora.

Projekt nie ma jednak kontraktu mówiącego, które elementy należą do edytowalnego layoutu. Istniejące `data-slot`, `groupId`, `projectId` i podobne pola identyfikują komponenty lub dane domenowe, ale nie definiują drzewa layoutu. Sama obserwacja DOM nie daje typowanej relacji rodzic–dziecko ani stabilnego modelu dla przyszłego przenoszenia grupy.

Docelowo użytkownik musi móc wskazać zarówno pojedynczy widget, jak i całe poddrzewo grupy:

```text
Dashboard
├── Sales
│   ├── Revenue
│   ├── Orders
│   └── Conversion
├── Marketing
│   ├── Campaigns
│   └── Traffic
└── Notifications
```

## 📋 Proposed Solution

Widok dashboardu otrzyma jeden rejestr layoutu. Komponent deklaruje stabilny `id`, `kind` i opcjonalny `parentId`. Rejestr waliduje unikalność, istnienie rodzica i brak cykli, a następnie udostępnia indeks, dzieci, snapshot oraz poddrzewo.

Przykładowy wpis:

```ts
{
  id: 'revenue',
  kind: 'widget',
  parentId: 'sales',
}
```

Wizualny reprezentant otrzymuje projekcję DOM:

```html
<article
  data-layout-element="true"
  data-layout-id="revenue"
  data-layout-kind="widget"
  data-layout-parent-id="sales"
>
  Revenue
</article>
```

DOM służy do hit-testu, focusu, podświetlenia i znalezienia reprezentanta. Nie jest podstawowym źródłem modelu.

## 📋 Architecture

### Moduły

- `packages/web/src/lib/layout-elements.ts` — typy, walidacja i czyste operacje na drzewie;
- `packages/web/src/components/layout-registry.tsx` — provider/kontekst jednego layoutu;
- `packages/web/src/components/layout-element.tsx` — deklaratywny wrapper rejestrujący element i emitujący atrybuty DOM;
- przyszły komponent edytora — konsument rejestru, poza tą fazą.

### Przepływ

1. Dashboard tworzy izolowany rejestr dla jednej instancji layoutu.
2. Widget lub grupa deklaruje `id`, `kind` i `parentId`.
3. Rejestr dodaje wpis podczas mount i usuwa go podczas unmount.
4. Wrapper renderuje `data-layout-*` na odpowiadającym elemencie.
5. Konsument pobiera snapshot oraz DOM node po logicznym `id`.
6. `editMode` decyduje o aktywności edytora; rejestr nie zna stanu shellu.

### Relacja do istniejącego guarda

`AppShell` nadal blokuje globalne aktywacje w `editMode`. Rejestr nie dodaje wyjątków dla sidebaru, routingu ani ustawień. Przyszłe akcje edytora będą jawnie oznaczone przez istniejący mechanizm `data-edit-mode-action="allow"` albo jego wyspecjalizowany odpowiednik.

## 📋 Data Model

```ts
type LayoutElementKind = 'widget' | 'group'

type LayoutElementDescriptor = {
  id: string
  kind: LayoutElementKind
  parentId?: string
}

type RegisteredLayoutElement = LayoutElementDescriptor & {
  children: string[]
  domNode?: Element
}
```

`children` jest wyliczane z `parentId`, aby relacja nie miała dwóch źródeł prawdy. `id` nie jest indeksem ani pozycją w gridzie. Nie wymagamy globalnej unikalności między projektami i trasami.

W tej fazie nie dodajemy `x`, `y`, `width`, `height`, trwałej kolejności, konfiguracji widgetu, storage, migracji, endpointu ani zdarzenia SSE/WebSocket.

## 📋 API Contracts

To kontrakt wewnętrzny klienta, nie HTTP API:

```ts
type LayoutRegistry = {
  register(element: LayoutElementDescriptor): () => void
  attachDomNode(id: string, node: Element): () => void
  get(id: string): RegisteredLayoutElement | undefined
  getChildren(id?: string): RegisteredLayoutElement[]
  getSubtree(id: string): RegisteredLayoutElement[]
  getSnapshot(): RegisteredLayoutElement[]
}
```

Duplikat `id`, brakujący rodzic, samoodwołanie i cykl są błędami walidacji. Rejestr nie nadpisuje cicho istniejącego wpisu, a snapshot jest niemutowalny dla konsumenta.

## 📋 UI/UX

Ta faza nie zmienia głównego wyglądu aplikacji. Przygotowuje jednak podstawy do tego, aby przyszły edytor mógł:

- wskazać dokładnie jeden widget po hover/focus;
- wskazać grupę bez automatycznego zaznaczania całego poddrzewa;
- jawnie wyznaczyć grupę wraz z potomkami do operacji;
- pominąć elementy spoza rejestru, w tym shell i nawigację;
- obsłużyć element zamontowany logicznie, ale chwilowo bez DOM node.

## 📋 Edge Cases & Failure Scenarios

- Duplikat `id` odrzuca nowy wpis i pozostawia istniejący bez zmian.
- Brakujący `parentId` nie może cicho zamienić elementu w korzeń; w produkcji wpis jest nieedytowalny, a w development pojawia się błąd.
- Cykl rodziców jest odrzucany przed rekurencją.
- Dziecko zadeklarowane przed rodzicem może zostać rozwiązane po zbudowaniu snapshotu, ale finalny snapshot nie zawiera nierozwiązanej relacji.
- Re-render i React Strict Mode nie tworzą duplikatów ani wycieków.
- Brak DOM node nie usuwa wpisu z modelu.
- Nieznany `kind` jest odrzucany przez typy i walidację runtime.
- Głębokie drzewo ma ochronę przed nieograniczoną rekurencją.
- Obecność widgetu w rejestrze nie odblokowuje jego normalnej akcji biznesowej w `editMode`.

## 📋 Risks & Impact Review

Zmiana jest ograniczona do klienta i przyszłego dashboardu. Nie zmienia API, danych serwerowych, konfiguracji ani tras. Rollback polega na usunięciu provider’a, wrappera i testów; istniejący `editMode` oraz guard działają niezależnie.

Najważniejsze ryzyka to pomieszanie identyfikatorów domenowych z layoutowymi, sprzężenie z chwilową strukturą DOM i niespójność przy dynamicznym mount/unmount. Ograniczają je osobny typ, prefiks `data-layout-*`, izolowany rejestr i testy lifecycle.

Wzorcem dla oddzielenia tożsamości od geometrii jest model paneli Grafany z osobnym `gridPos`; dnd-kit rozdziela stabilny identyfikator elementu od kontekstu/kontenera, a React Grid Layout modeluje element layoutu niezależnie od jego renderowanego DOM ([Grafana](https://github.com/grafana/grafana/blob/main/docs/sources/visualizations/dashboards/build-dashboards/view-dashboard-json-model/index.md), [dnd-kit](https://github.com/clauderic/dnd-kit/blob/main/apps/docs/docs/react/guides/sortable-state-management.mdx), [React Grid Layout](https://github.com/react-grid-layout/react-grid-layout/blob/master/README.md)). Nie dodajemy tych bibliotek do projektu.

## 📋 Phasing

### Phase 1 — Model i rejestr

Typy, walidacja i operacje na drzewie. Faza kończy się działającym rejestrem bez UI.

### Phase 2 — Integracja komponentowa

Provider, wrapper widgetu/grupy i atrybuty `data-layout-*`. Faza kończy się dashboardem, którego elementy można znaleźć po `id`.

### Phase 3 — Konsument discovery

Snapshot, lookup i poddrzewo dla przyszłego edytora. Bez drag-and-drop, geometrii, zapisu i API.

## 📋 Implementation Plan

### Phase 1 — Model i rejestr

1. Zdefiniować typy `LayoutElementKind`, `LayoutElementDescriptor` i wpis zarejestrowany; test kompilacji odrzuca nieznany `kind`.
2. Zaimplementować rejestr, `get`, `getChildren`, `getSubtree`, snapshot i wyrejestrowanie; testy obejmują widget korzeniowy, widget w grupie i grupę w grupie.
3. Dodać walidację duplikatów, brakującego rodzica, cykli i samoodwołania; testy potwierdzają brak częściowego uszkodzenia indeksu.
4. Zweryfikować mount/unmount/re-render w React Strict Mode.

### Phase 2 — Integracja komponentowa

5. Dodać provider izolujący rejestr jednej instancji layoutu.
6. Dodać wrapper deklaratywny dla widgetu i grupy z bezpiecznym lifecycle.
7. Emitować `data-layout-element`, `data-layout-id`, `data-layout-kind` i opcjonalny `data-layout-parent-id`.
8. Zintegrować wyłącznie z przyszłym layoutem dashboardu; nie oznaczać `AppShell`, sidebaru, nawigacji ani ustawień.

### Phase 3 — Discovery

9. Udostępnić lookup logicznego `id` i zamontowanego DOM node bez skanowania całego dokumentu.
10. Udostępnić deterministyczne wyznaczanie całego poddrzewa grupy.
11. Dodać neutralny snapshot dla przyszłego edytora i test niemutowalności.
12. Uruchomić gate repozytorium: `npm run typecheck`, testy jednostkowe i build.

## 📋 Acceptance Criteria

- [ ] Dashboard posiada izolowany, typowany rejestr elementów.
- [ ] Widget i grupa mają różne wartości `kind`.
- [ ] Widget może być korzeniem albo dzieckiem grupy.
- [ ] Grupa może zawierać widgety i inne grupy.
- [ ] `parentId` opisuje relację rodzic–dziecko.
- [ ] Duplikaty, brakujący rodzic, samoodwołanie i cykle są wykrywane.
- [ ] Re-render i React Strict Mode nie tworzą duplikatów.
- [ ] Zamontowane elementy mają `data-layout-id` i `data-layout-kind`.
- [ ] Atrybuty DOM są projekcją rejestru.
- [ ] Można pobrać pojedynczy element i całe poddrzewo grupy.
- [ ] Shell, sidebar, nawigacja i ustawienia nie trafiają do rejestru.
- [ ] Nie dodano API, persystencji, geometrii, drag-and-drop, resize ani usuwania.
- [ ] Istniejący guard `editMode` nadal blokuje akcje biznesowe poza dozwolonymi akcjami edytora.

Spec: .ai/specs/2026-09-19-editable-layout-elements-discovery.md
