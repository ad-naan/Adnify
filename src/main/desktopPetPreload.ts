import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DesktopPetViewApi, PetReaction, PetViewState } from '@shared/desktopPet'

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DesktopPetViewApi = {
  getState: () => ipcRenderer.invoke('desktop-pet:get-state'),
  readAsset: (id, path) => ipcRenderer.invoke('desktop-pet:asset', id, path),
  react: (reaction, actions) => ipcRenderer.invoke('desktop-pet:react', reaction, actions),
  speak: id => ipcRenderer.invoke('desktop-pet:speak', id),
  stopSpeech: () => ipcRenderer.send('desktop-pet:stop-speech'),
  drag: phase => ipcRenderer.send('desktop-pet:drag', phase),
  openSettings: () => ipcRenderer.send('desktop-pet:open-settings'),
  close: () => ipcRenderer.send('desktop-pet:close'),
  onState: callback => subscribe<PetViewState>('desktop-pet:state', callback),
  onReaction: callback => subscribe<PetReaction>('desktop-pet:reaction', callback),
}

contextBridge.exposeInMainWorld('desktopPet', api)
