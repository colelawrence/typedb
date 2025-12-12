import type React from "react";

import { DevInfoDot } from "#scripts/lib/dev/DevInfoDot.tsx";
import { DevState } from "#scripts/lib/dev/DevState.tsx";
import { useTodoVM } from "../TodoVMContext.tsx";
import { Queryable } from "./Queryable.tsx";

export const Header: React.FC = () => {
  const vm = useTodoVM();

  return (
    <header $="header">
      <h1 $>Todo List View</h1>
      <DevInfoDot
        $="absolute bottom-2 left-2"
        dismissKey="todo-vm"
        children={<DevState $ data={vm} name="Todo VM" />}
        data-hide="#hide"
      />
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
    </header>
  );
};
