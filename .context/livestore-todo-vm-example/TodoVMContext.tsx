import { createContext, useContext } from "react";
import type { TodoListVM } from "./scope";

export const TodoVMContext = createContext<TodoListVM | null>(null);

export const useTodoVM = () => {
  const vm = useContext(TodoVMContext);
  if (!vm) throw new Error("useTodoVM must be used within TodoVMProvider");
  return vm;
};
