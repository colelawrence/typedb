import { computed, nanoid, queryDb } from "@livestore/livestore";
import type { Queryable, Store } from "@livestore/livestore";

import { DisposePool, dev, memoFn } from "@phosphor/utils";
import { emitDebugValue, emitDebugValueFn, emitFunctionCall } from "#scripts/lib/dev/emitDebugValue.ts";
import { uiState$ } from "./livestore/queries.js";
import { events, type schema, tables } from "./livestore/schema.js";

const pluralize = (count: number, singular: string, plural: string) => (count === 1 ? singular : plural);

// #region todo-vm-livestore
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
  reset: () => void; // #hide
};
// #endregion todo-vm-livestore

// #region todo-scope-livestore
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

  // #hide debugs
  store.subscribe(newTodoText$, emitDebugValueFn("!newTodoText", dev``));
  store.subscribe(currentFilter$, emitDebugValueFn("!currentFilter", dev``));
  store.subscribe(incompleteDisplayText$, emitDebugValueFn("!incompleteDisplayText", dev``));
  let pool = new DisposePool();
  store.subscribe(visibleTodos$, (todos) => {
    pool.dispose();
    pool = new DisposePool();
    const [first] = todos;
    if (first) {
      pool.add(store.subscribe(first.completed$, emitDebugValueFn("!todo.completed", dev``)));
      pool.add(store.subscribe(first.text$, emitDebugValueFn("!todo.text", dev``)));
    } else {
      emitDebugValue("!todo.text", dev``, null);
      emitDebugValue("!todo.completed", dev``, null);
    }
  });
  // #endhide debugs

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
    reset: () => store.commit(events.stateReset({}), events.uiStateSet({ newTodoText: "", filter: "all" })), // #hide
  };
}
// #endregion todo-scope-livestore
