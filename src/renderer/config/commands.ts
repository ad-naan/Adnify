
import { keybindingService, isMac } from '@services/keybindingService'

export const registerCoreCommands = () => {
    const commands = [
        // --- File ---
        { id: 'file.save',                              title: 'Save File',                     category: 'File',       defaultKey: 'Ctrl+S' },
        { id: 'file.open',                              title: 'Open File',                     category: 'File',       defaultKey: 'Ctrl+O' },
        { id: 'editor.save',                            title: 'Save File (Editor)',             category: 'File',       defaultKey: 'Ctrl+S' },
        { id: 'editor.closeFile',                       title: 'Close Active File',              category: 'Editor',     defaultKey: 'Ctrl+W' },
        { id: 'editor.cancel',                          title: 'Cancel Operation',               category: 'Editor',     defaultKey: 'Escape' },
        { id: 'editor.find',                            title: 'Find',                          category: 'Editor',     defaultKey: 'Ctrl+F' },
        { id: 'editor.replace',                         title: 'Replace',                       category: 'Editor',     defaultKey: 'Ctrl+H' },

        // --- View ---
        { id: 'view.toggleSidebar',                     title: 'Toggle Sidebar',                category: 'View',       defaultKey: 'Ctrl+B' },
        { id: 'view.toggleTerminal',                    title: 'Toggle Terminal',               category: 'View',       defaultKey: 'Ctrl+`' },
        { id: 'view.toggleDebug',                       title: 'Toggle Debug Panel',            category: 'View',       defaultKey: 'Ctrl+Shift+D' },

        // --- Workbench ---
        // 注意：F1 在 useGlobalShortcuts 中作为备用键单独处理
        { id: 'workbench.action.showCommands',          title: 'Show Command Palette',          category: 'View',       defaultKey: 'Ctrl+Shift+P' },
        { id: 'workbench.action.quickOpen',             title: 'Go to File',                    category: 'File',       defaultKey: 'Ctrl+P' },
        { id: 'workbench.action.openSettings',          title: 'Open Settings',                 category: 'File',       defaultKey: 'Ctrl+,' },
        { id: 'workbench.action.toggleComposer',        title: 'Toggle Composer',               category: 'View',       defaultKey: 'Ctrl+Shift+I' },
        { id: 'workbench.action.showShortcuts',         title: 'Keyboard Shortcuts',            category: 'Help',       defaultKey: '?' },
        { id: 'workbench.action.closePanel',            title: 'Close Panel',                   category: 'View',       defaultKey: 'Escape' },
        // DevTools 快捷键：Windows/Linux 用 F12，macOS 用 Cmd+Option+I
        // 当 Monaco 编辑器聚焦时，F12 会被放行给 Monaco 内部執行跳转定义，不会触发 DevTools
        { id: 'workbench.action.toggleDevTools',        title: 'Toggle Developer Tools',        category: 'Help',       defaultKey: isMac ? 'Ctrl+Alt+I' : 'F12' },

        // --- Debug ---
        { id: 'debug.start',                            title: 'Start Debugging',               category: 'Debug',      defaultKey: 'F5' },
        { id: 'debug.stop',                             title: 'Stop Debugging',                category: 'Debug',      defaultKey: 'Shift+F5' },
        { id: 'debug.stepOver',                         title: 'Step Over',                     category: 'Debug',      defaultKey: 'F10' },
        { id: 'debug.stepInto',                         title: 'Step Into',                     category: 'Debug',      defaultKey: 'F11' },
        { id: 'debug.stepOut',                          title: 'Step Out',                      category: 'Debug',      defaultKey: 'Shift+F11' },
        { id: 'debug.toggleBreakpoint',                 title: 'Toggle Breakpoint',             category: 'Debug',      defaultKey: 'F9' },

        // --- Chat ---
        { id: 'chat.send',                              title: 'Send Message',                  category: 'Chat',       defaultKey: 'Enter' },
        { id: 'chat.stop',                              title: 'Stop Generation',               category: 'Chat',       defaultKey: 'Escape' },

        // --- List / Tree ---
        { id: 'list.select',                            title: 'Select Item',                   category: 'List',       defaultKey: 'Enter' },
        { id: 'list.cancel',                            title: 'Cancel Selection',              category: 'List',       defaultKey: 'Escape' },
        { id: 'list.focusDown',                         title: 'Focus Next Item',               category: 'List',       defaultKey: 'ArrowDown' },
        { id: 'list.focusUp',                           title: 'Focus Previous Item',           category: 'List',       defaultKey: 'ArrowUp' },

        // --- Git ---
        { id: 'git.commit',                             title: 'Commit Changes',                category: 'Git',        defaultKey: 'Ctrl+Enter' },

        // --- Terminal ---
        { id: 'terminal.new',                           title: 'New Terminal',                  category: 'Terminal',   defaultKey: 'Ctrl+Shift+`' },

        // --- Explorer ---
        { id: 'explorer.revealActiveFile',              title: 'Reveal Active File in Explorer',category: 'File',       defaultKey: 'Ctrl+Shift+E' },
        { id: 'explorer.revealInSidebar',               title: 'Reveal in Sidebar',             category: 'Explorer',   defaultKey: 'Alt+Shift+L' },
        { id: 'explorer.rename',                        title: 'Rename File/Folder',            category: 'Explorer',   defaultKey: 'F2' },
        { id: 'explorer.copy',                          title: 'Copy File/Folder',              category: 'Explorer',   defaultKey: 'Ctrl+C' },
        { id: 'explorer.paste',                         title: 'Paste File/Folder',             category: 'Explorer',   defaultKey: 'Ctrl+V' },

        // --- Help ---
        { id: 'help.about',                             title: 'About',                         category: 'Help',       defaultKey: '' },
    ]

    commands.forEach(cmd => keybindingService.registerCommand(cmd))
}
