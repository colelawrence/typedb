---
title: "Writing view model interfaces"
description: "Designing the boundary between view and business logic."
date: "2025-10-17"
draft: true
authors: ["Cole Lawrence"]

---

Authors: Cole Lawrence ([website](https://colelawrence.com), [x](https://x.com/refactorordie), [github](https://github.com/colelawrence))

## Intro

I could never make sense of React hooks once `useEffect`s, `useState`s, and contexts piled up. I'd squint at the code and kind of follow a few pieces, but I couldn't honestly say I understood what was happening. Event handling, styling, render performance, testing it all blurred together.

Now my AI agents have the same problem.

The pattern that solved this for me and now keeps my agents from accruing subtle technical debt is the view model interface. It's the slice of model-view-view-model that matters: a clear separation between business logic (what your app does uniquely) and view concerns (events, animation, web/native-specific challenges). I don't care how you implement your business logic or state management. All that matters is the separation, so AI can work out implementations without tangling domain logic with UI noise.

# What is a View Model Interface?

By strictly following a few rules for view model interfaces, we define a clean boundary between the User Interface (UI) and the actual business logic. This offers two significant advantages:

1. **Reduced complexity**: our business logic and UI are isolated from each other, making both easier to reason about.
2. **Testing**: our tests can test what matters without rendering the UI, making our tests faster, more focused, and easier to maintain.

Let's take a look at an example of a typical autocomplete's view model:

```typescript
import type { Queryable } from "@livestore/livestore"; // #muted

export interface AutocompleteVM {
  inputText$: Queryable<string>;
  updateInput(text: string, pos: "end" | number): void;
  pressKey(key: "enter" | "up" | "down" | "escape"): void;
  options$: Queryable<
    Array<{
      key: string;
      label: string;
      selected$: Queryable<boolean>;
      click(): void;
    }>
  >;
}
```

As you can see, _it isn't magic_. It should seem very familiar, and only a couple of deliberate choices give us incredible power in the design and implementation phases that we orchestrate with our agents.

---

### Try it

 <!-- Interactive Demo: autocomplete --> 

### Test it

```typescript
autocomplete.updateInput("Update @ind", "end");
const options = query(autocomplete.options$);
expect(options).toMatchObject([
  { label: "src/index.html" },
  { label: "src/index.ts" },
  { label: "src/utils/index.ts" },
]);

// Default is that the first option is selected
expect(query(options[0].selected$)).toBe(true);
expect(query(options[1].selected$)).toBe(false);

autocomplete.pressKey("down");
expect(query(options[0].selected$)).toBe(false);
expect(query(options[1].selected$)).toBe(true);
```

{% internal_meta(title="Note on testing") %}

Second to simply using TypeScript and view models, tests are the absolute best way to manage regressions and expectations in any rapidly changing codebase. Tests against view models don't require additional harnesses or indirection, and can be executed quickly without any sort of browser environment emulation.

# The Four Rules

1. Let the view model structure mirror the UI
2. Use fine-grained reactive primitives (no global invalidation)
3. Accept domain inputs; return UI-ready outputs
4. Keep event handlers side-effectful but opaque to the view

## 1. Let the view model structure mirror the UI

Shape your View Model hierarchy to directly mirror what appears in the UI.
{% bad_good() %}

```typescript
historyManagement: {
  draftChanges,
  timelineScrubber,
}
```

<!-- vs -->

```typescript
topBar: { historyTimelineScrubber },
sidePanel: { draftChangeArea }
```

> **Tip:** Include doc-comments to clarify nuanced behavior.

## 2. Use fine-grained reactive primitives

Avoid global invalidation or full re-renders. Reading our view model interface should tell other engineers exactly what parts of the application are dynamic.

Reactive fields usually end with a special suffix like `*$` or `*Atom` depending on the framework (e.g., `isSelected$`) to signal they may change during the VM instance's lifetime. Static fields (no suffix) are appropriate when the value is fixed for as long as that VM object exists; if the underlying data changes structurally, create new VM instances rather than mutating existing ones.

{% bad_good() %}

```typescript
type ListVM = {
  items: ItemVM[];
  // ...
};
type ItemVM = {
  itemSelected: boolean;
  // ...
};
```

<!-- vs -->

```typescript
type ListVM = {
  items$: Queryable<ItemVM[]>;
  // ...
};
type ItemVM = {
  itemSelected$: Queryable<boolean>;
  // ...
};
```

## 3. Accept domain inputs; return UI-ready outputs

### Present Data as UI-Ready Strings

Every piece of data shown to the user should already be localized and formatted before it reaches the UI. For example, don't expose raw types like `Date` or `number` directly; pre-format for display.
{% bad_good() %}

```typescript
datePosted: Date;
```

<!-- vs -->

```typescript
postedAtDisplay: string; // "Thu, Nov 20th, 2025"
```

<!-- or -->

```typescript
amount: number;
currency: string;
currencySide: "left" | "right";
```

<!-- vs -->

```typescript
amountDisplay: string; // "$1,000.00" or "Â£1,000.00" or "1.000 BRL"

// For more complex UIs:
amountDisplay: {
  pre: string; // "$" or "Â£" or ""
  number: Array<{ text: string; muted: boolean }>; // [{ text: "1", muted: false }, { text: ",", muted: true }, { text: "000", muted: false }, { text: ".00", muted: true }]
  post: string; // "USD" or "GBP" or "BRL"
}
```

### Never Expose Raw IDs to the UI

Exposing IDs can lead the UI to leak business logic and is risky with AI assuming it can use IDs for business logic in the UI.
{% bad_good() %}

```typescript
type ListVM = {
  onClickItem(id: string): void;
  items: { id: string }[];
};
```

<!-- vs -->

```typescript
type ListVM = {
  items: Array<{
    key: string;
    onClick: () => void;
  }>;
};
```

### Pattern: Domain Model vs. View Model

When mapping a domain object to a view model, transform the ID into a `key` and keep the ID hidden within the closure.

```typescript
// Domain model
type User = { id: string; name: string };

// View model
type UserRowVM = {
  key: string; // usually the User.id (or a composite)
  label: string; // user-facing name
  onClick: () => void; // callback closes over User.id internally
};
```

## 4. Keep event handlers side-effectful but opaque to the view

This further limits what the UI can access, preventing the implementer from relying on patterns (like returning promises) that could lead to UI logic handling async side-effects, which should remain hidden behind the view model boundary.
{% bad_good() %}

```typescript
onClick: () => Promise<void>;
```

<!-- vs -->

```typescript
onClick: () => void;
```

# Composition

A View Model Interface isn't meant to be a single monolithic object. Just as we compose UI components a `Page` containing a `Sidebar` and a `ContentArea` we compose View Models.

This is achieved by nesting interfaces. A "parent" View Model simply exposes "child" View Models as properties.

```typescript
interface PageVM {
  sidebar: SidebarVM;
  content: ContentVM;
}
```

On the UI side, you mirror this composition by wiring up the VM tree directly to your component tree:

```tsx
function Page({ vm }: { vm: PageVM }) {
  return (
    
      <Sidebar vm={vm.sidebar} />
      <Content vm={vm.content} />
    
  );
}
```

This compositional approach enables what I call **fractal architecture** every view model is safely encapsulated, and yet can be composed into arbitrarily complex applications. Here are the benefits:

1. **Isolation & Testability**: Components consume only the view model slice they need, e.g. `Sidebar` uses just a `SidebarVM`, so tests and changes are tightly scoped.
2. **Scalability**: By assembling applications from modular view models, complexity scales linearly instead of exponentially.
3. **Parallel Work**: Different teams or AI agents can implement and evolve isolated view model sections (`Sidebar`, `Content`) after a shared interface contract is established.

In practice, this architecture automates separation of concerns and encourages durable, easy-to-refactor code.

---

# Practices & Edge Cases

## Using inline reactivity can be nice

Don't arbitrarily split up components often, it's clearer to use an inline reactive renderer:

```jsx
<Queryable query={vm.todos$}>
  {todos => /* this is a valid hook context */}
</Queryable>

<Queryable query={vm.header.newTodoText$}>
  {(newTodoText) => (
    <input
      $="new-todo"
      placeholder="What needs to be done?"
      value={newTodoText}
      onChange={(e) => vm.header.updateNewTodoText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          vm.header.addTodo();
        }
      }}
    />
  )}
</Queryable>

<span $="todo-count">
  <Queryable query={vm.footer.incompleteDisplayText$} />
</span>
```

This approach also suits LLMs, which typically make focused edits within single blocks rather than scattered edits.

## React components on the view model are OK (with a caveat)

You can attach presentational React components (like icons or renderer functions) directly to your view model, so long as:

- The _business logic_ remains fully testable.
- Those components are strictly for rendering/decoration.

```ts
icon: typeof Ta.Icon123;
renderDiff: (props) => React.ReactNode;
```

## Prefer booleans over discriminated unions where possible

Flatten unions for simple UI controls (buttons, dropdowns, etc.) to reduce UI complexity and make event handling, rendering, and testing more straightforward. Try to minimize conditional logic and indirection.

{% bad_good() %}

```typescript
type ButtonVM = {
  enabled$: Queryable<
    | { enabled: true; click: () => void } //
    | { enabled: false; disableDisplayReason: string }
  >;
};
```

<!-- vs -->

```typescript
type ButtonVM = {
  disabled$: Queryable<null | { displayReason: string }>;
  // click is always available, even if root-level event wiring is needed
  click: () => void;
};
```

<!-- or -->

```typescript
type DropdownVM = {
  state$: Queryable<
    | {
        state: "open";
        keyDown: (key: "up" | "down") => void;
      }
    | {
        state: "closed";
      }
  >;
};
```

<!-- vs -->

```typescript
type DropdownVM = {
  options$: Queryable<DropdownItemVM[]>;
  keyDown: (key: "up" | "down") => boolean;
};
```

## Keyboard/event handlers may return booleans

Allow your keyboard or other event handlers to return a boolean indicating whether they've handled the event (to control propagation/default handling):

```ts
onKeyDown(event): boolean
```

## Add an opaque `_dev` field for debugging

Add a field like `_dev: Record<string, unknown>` to your model for UI-side debugging tools.  
_Just ensure its structure remains opaque._

## Animation triggers

View Models can expose animation triggers using `SignalDef<number>` for precise control over visual feedback:

```typescript
interface ProposalVM {
  // ... other properties

  // Animation triggers - writable signals that increment to trigger effects
  animationTriggers: {
    commitAdded$: SignalDef<number>; // Flash when commit added
    merged$: SignalDef<number>; // Pulse when merged
  };
}
```

**Why this pattern?**

- **Declarative**: Reading the interface reveals animation capabilities
- **Testable**: Writables allow resetting and manual triggering in tests
- **Framework-agnostic**: Works with any reactive renderer
- **Self-describing**: Clear semantic meaning in the interface

<br/>

**Component consumption:**

```tsx
function ProposalComponent({ proposal }: { proposal: ProposalVM }) {
  const trigger = useQuery(proposal.animationTriggers.commitAdded$);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (trigger > 0) {
      setIsAnimating(true);
      const handle = setTimeout(() => setIsAnimating(false), 500);
      return () => clearTimeout(handle);
    }
  }, [trigger]);

  const { chroma, hue } = proposal.backgroundColor;
  const style = isAnimating
    ? {
        boxShadow: `0 0 0 2px oklch(0.75 ${chroma} ${hue})`,
        backgroundColor: `oklch(0.95 ${chroma * 0.3} ${hue})`,
      }
    : undefined;

  return (
    
      {/* proposal content */}
    
  );
}
```

<br/>

**Testing:**

```typescript
// Reset animation state
liveStore.setSignal(proposal.animationTriggers.commitAdded$, 0);

// Manually trigger for testing
liveStore.setSignal(proposal.animationTriggers.commitAdded$, (n) => n + 1);
```

This pattern ensures animations are triggered from business logic events while keeping the UI a pure projection of state.

---

# Examples

## Example 1: Autocomplete

---

### View / Test

 <!-- Interactive Demo: autocomplete --> 

### Interface

```typescript
export interface AutocompleteVM {
  /** The actual user's input text area */
  inputText$: Queryable<string>; // !autocomplete-inputText
  updateInput(text: string, pos: "end" | number): void; // !call:autocomplete-updateInput
  /** Selection affects the autocomplete options */
  updateSelection(pos: number, anchor?: number): void; // !call:autocomplete-updateSelection
  /** Keyboard navigation affects what is selected */
  pressKey(key: "enter" | "up" | "down" | "escape"): void; // !call:autocomplete-pressKey

  /** Options shown below the editor input when non-empty */
  options$: Queryable<
    Array<{
      key: string;
      label: string;
      selected$: Queryable<boolean>;
      click(): void; // !call:autocomplete-option-click
    }>
    // !autocomplete-options
  >;
}
```

## Example 2: Todo List

---

<!-- Left pane -->

### Interface

<!--  -->

```typescript
export type TodoItemVM = {
  key: string;
  text$: Queryable<string>; // !todo.text
  completed$: Queryable<boolean>; // !todo.completed
  toggleCompleted: () => void; // !call:todo-toggleCompleted
  remove: () => void; // !call:todo-remove
};

export type TodoListVM = {
  header: {
    newTodoText$: Queryable<string>; // !newTodoText
    updateNewTodoText: (text: string) => void; // !call:todo-updateNewTodoText
    addTodo: () => void; // !call:todo-addTodo
  };
  itemList: {
    items$: Queryable<TodoItemVM[]>; // !visibleTodos
  };
  footer: {
    incompleteDisplayText$: Queryable<string>; // !incompleteDisplayText
    currentFilter$: Queryable<"all" | "active" | "completed">; // !currentFilter
    showAll: () => void; // !call:todo-showAll
    showActive: () => void; // !call:todo-showActive
    showCompleted: () => void; // !call:todo-showCompleted
    clearCompleted: () => void; // !call:todo-clearCompleted
  };
  reset: () => void;
};
```

<!-- Right pane -->

### React Code

<!-- Interactive Demo: todo-vm -->

```tsx
export const MainSection: React.FC = () => {
  const vm = useTodoVM();
  const sectionRef = useRef<HTMLElement>(null);

  return (
    <section ref={sectionRef} $="todos">
      <ul $="todo-list">
        <Queryable query={vm.itemList.items$}>
          {(items) =>
            items.map((item) => (
              <li $="state" key={item.key}>
                <Queryable query={item.completed$}>
                  {(completed) => (
                    <input $="toggle" type="checkbox" checked={completed} onChange={() => item.toggleCompleted()} />
                  )}
                </Queryable>
                <label $>
                  <Queryable query={item.text$} />
                </label>
                <button type="button" $="destroy" onClick={() => item.remove()} />
              </li>
            ))
          }
        </Queryable>
      </ul>
    </section>
  );
};
```

<!-- Specific to LiveStore -->

{% collapsible(title="Todo List Business Logic") %}

And if you're curious about the "business logic" for the Todo List, I've included the scope below, but I'll say that in my experience, AI is usually very good with maintaining because it's forced to adhere to returning the correct types for the view-model interface & it will be guided by test-driven development.

<!-- more -->

```typescript
const createID = (name: string) => `${name}_${nanoid(12)}`; // #muted
export function createTodoListScope(store: Store<typeof schema>): TodoListVM {
  const currentFilter$ = computed((get) => get(uiState$).filter, { label: "filter" });
  const newTodoText$ = computed((get) => get(uiState$).newTodoText, { label: "newTodoText" });

  const createTodoItemVM = memoFn((id: string): TodoItemVM => {
    const completed$ = /* #fold */ queryDb(
      tables.todos.select("completed").where({ id }).first({ behaviour: "error" }),
      { label: "todoItem.completed", deps: [id] },
    );
    const text$ = /* #fold */ queryDb(tables.todos.select("text").where({ id }).first({ behaviour: "error" }), {
      label: "todoItem.text",
      deps: [id],
    });
    return {
      key: id,
      completed$,
      text$,
      toggleCompleted: () => {
        emitFunctionCall("todo-toggleCompleted", { args: [] });
        store.commit(store.query(completed$) ? events.todoUncompleted({ id }) : events.todoCompleted({ id }));
      },
      remove: () => {
        emitFunctionCall("todo-remove", { args: [] });
        store.commit(events.todoDeleted({ id, deletedAt: new Date() }));
      },
    };
  });

  const visibleTodosQuery = (filter: "all" | "active" | "completed") =>
    queryDb(
      () =>
        tables.todos.where({
          completed: filter === "all" ? undefined : filter === "completed",
          deletedAt: { op: "=", value: null },
        }),
      {
        label: "visibleTodos",
        map: (rows) => rows.map((row) => createTodoItemVM(row.id)),
        deps: [filter],
      },
    );

  const visibleTodos$ = /* #fold */ computed(
    (get) => {
      const filter = get(currentFilter$);
      return get(visibleTodosQuery(filter));
    },
    { label: "visibleTodos" },
  );

  const incompleteCount_$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
    label: "incompleteDisplayText",
  });
  const incompleteDisplayText$ = computed(
    (get) => `${get(incompleteCount_$)} ${pluralize(get(incompleteCount_$), "item", "items")} left`,
  );

  return {
    header: {
      newTodoText$,
      updateNewTodoText: (text: string) => {
        emitFunctionCall("todo-updateNewTodoText", { args: [text] });
        store.commit(events.uiStateSet({ newTodoText: text }));
      },
      addTodo: () => {
        emitFunctionCall("todo-addTodo", { args: [] });
        const newTodoText = store.query(newTodoText$).trim();
        if (newTodoText) {
          store.commit(
            events.todoCreated({ id: createID("todo"), text: newTodoText }),
            events.uiStateSet({ newTodoText: "" }), // update text
          );
        }
      },
    },
    itemList: {
      items$: visibleTodos$,
    },
    footer: {
      incompleteDisplayText$,
      currentFilter$,
      showAll: () => {
        emitFunctionCall("todo-showAll", { args: [] });
        store.commit(events.uiStateSet({ filter: "all" }));
      },
      showActive: () => {
        emitFunctionCall("todo-showActive", { args: [] });
        store.commit(events.uiStateSet({ filter: "active" }));
      },
      showCompleted: () => {
        emitFunctionCall("todo-showCompleted", { args: [] });
        store.commit(events.uiStateSet({ filter: "completed" }));
      },
      clearCompleted: () => {
        emitFunctionCall("todo-clearCompleted", { args: [] });
        store.commit(events.todoClearedCompleted({ deletedAt: new Date() }));
      },
    },
    reset: () => store.commit(events.stateReset({}), events.uiStateSet({ newTodoText: "", filter: "all" })),
  };
}
```

<!-- End: Specific to LiveStore -->

## Example 3: Nested Composition

Real applications have deeply nested UIs. A typical sidebar might contain navigation, a user profile area, usage limits, dropdown menus each with their own state and interactions. How do you keep this manageable?

The answer is fractal composition: each piece of UI gets its own view model, and parent view models simply expose child view models as properties. The sidebar doesn't need to know _how_ the user profile section works it just passes `vm.userProfileSection` to the component.

```typescript title="SidebarVM"
interface SidebarVM {
  navigation: NavigationVM;
  /** Sits below the main navigation */
  userProfileSection: SidebarUserProfileSectionVM;
}
```

The profile section contains multiple concerns article limits, logged-in state, logged-out state each scoped to what that part of the UI actually needs:

```typescript title="SidebarUserProfileSectionVM"
interface SidebarUserProfileSectionVM {
  /** Usage limits shown as a progress bar or text */
  articleLimit: SidebarArticleLimitVM;
  /** Shown when user is authenticated */
  loggedInUser$: Queryable<SidebarLoggedInUserVM | null>;
  /** Shown when user is not authenticated */
  loggedOut$: Queryable<SidebarLoggedOutVM | null>;
}
```

```typescript title="SidebarArticleLimitVM" collapsible collapsed
interface SidebarArticleLimitVM {
  hasUnlimitedArticles: boolean;
  freeArticlesRemaining$: Queryable<number>;
  currentArticleContributesToLimit$: Queryable<boolean>;
}
```

```typescript title="SidebarLoggedInUserVM" collapsible collapsed
interface SidebarLoggedInUserVM {
  displayName: string;
  avatarUrl: string;
  role: "guest" | "member" | "admin";
  dropdownMenu: SidebarUserDropdownMenuVM;
}

interface SidebarUserDropdownMenuVM {
  /** Options may change based on role, feature flags, etc. */
  options$: Queryable<
    Array<{
      key: string;
      label: string;
      icon: Ta.Icon;
      onClick: () => void; // closes over IDs UI never sees them
    }>
  >;
}
```

```typescript title="SidebarLoggedOutVM" collapsible collapsed
interface SidebarLoggedOutVM {
  loginButton: {
    onClick: () => void;
  };
  // Could expand with SSO options, sign-up link, etc.
}
```

Notice how `loggedInUser$` and `loggedOut$` are reactive and mutually exclusive only one is non-null at a time. The UI can simply check which one to render without complex conditional logic.

### But what about the edit modal?

When the user clicks "Edit Profile" from the dropdown, a modal opens. This modal also deals with "user profile" data but it's a completely different UI with different concerns: form fields, validation, saving state.

Should we reuse `SidebarUserProfileSectionVM`? **No.** That would couple two unrelated UI surfaces together.

Instead, we create a separate view model named after _where it lives in the UI_:

```typescript title="UserProfileEditModalVM"
interface UserProfileEditModalVM {
  /** Modal visibility and close action */
  isOpen$: Queryable<boolean>;
  close: () => void;

  /** Form fields */
  displayName: {
    value$: Queryable<string>;
    update: (value: string) => void;
    error$: Queryable<string | null>;
  };
  avatarUrl: {
    value$: Queryable<string>;
    update: (value: string) => void;
    error$: Queryable<string | null>;
  };

  /** Form actions */
  save: () => void;
  saving$: Queryable<boolean>;
  canSave$: Queryable<boolean>;
}
```

Both VMs deal with the same domain concept, but they serve completely different UI purposes. The sidebar shows a read-only summary; the modal handles editing with validation and error handling.

**The naming convention:** View model types are named after their _UI location_, not their domain concept. Your app might have:

- `SidebarUserProfileSectionVM`   the compact profile card in the sidebar
- `UserProfilePageVM`   the full profile page at `/settings/profile`
- `UserProfileEditModalVM`   the modal that opens when you click "Edit"

This prevents naming collisions and makes it immediately clear _where_ each VM is used. When you need to change how the dropdown works, you only touch `SidebarUserDropdownMenuVM`. When you need to add validation to the edit modal, you only touch `UserProfileEditModalVM`. The sidebar doesn't care it just passes view models down.
Drag handle
Insight icon
logo
