import { ToolRegistry } from "../agent/registry.js";
import calculatorTool from "./basic/calculator.js";
import datetimeTool from "./basic/datetime.js";
import browserBackTool from "./browser/goBack.js";
import browserClickTool from "./browser/clickElement.js";
import browserOpenTool from "./browser/openPage.js";
import browserReadPageTool from "./browser/readPage.js";
import browserRefreshTool from "./browser/refreshPage.js";
import browserScreenshotTool from "./browser/screenshot.js";
import browserTypeTool from "./browser/typeInto.js";
import listDirectoryTool from "./fs/listDirectory.js";
import readFileTool from "./fs/readFile.js";
import searchFilesTool from "./fs/searchFiles.js";
import writeFileTool from "./fs/writeFile.js";
import todoTool from "./memory/todo.js";
import { createShowAvailableToolsTool } from "./meta/showAvailableTools.js";
import runCommandTool from "./system/runCommand.js";

export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(datetimeTool);
  registry.register(calculatorTool);
  registry.register(browserBackTool);
  registry.register(browserClickTool);
  registry.register(browserOpenTool);
  registry.register(browserReadPageTool);
  registry.register(browserRefreshTool);
  registry.register(browserScreenshotTool);
  registry.register(browserTypeTool);
  registry.register(listDirectoryTool);
  registry.register(readFileTool);
  registry.register(searchFilesTool);
  registry.register(writeFileTool);
  registry.register(runCommandTool);
  registry.register(todoTool);
  registry.register(createShowAvailableToolsTool(registry));
  return registry;
}
