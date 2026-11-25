import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

function scanPublicModels(publicDir: string): string[] {
  const modelsDir = path.join(publicDir, 'models')
  if (!fs.existsSync(modelsDir)) return []

  const results: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (/\.(glb|gltf)$/i.test(entry.name)) {
        const rel = path.relative(publicDir, fullPath).split(path.sep).join('/')
        results.push(`/${rel}`)
      }
    }
  }

  walk(modelsDir)
  return results.sort()
}

function publicModelsPlugin(): Plugin {
  const virtualModuleId = 'virtual:public-models'
  const resolvedVirtualModuleId = '\0' + virtualModuleId
  let publicDir = path.resolve(process.cwd(), 'public')

  return {
    name: 'public-models-list',
    configResolved(config) {
      publicDir = config.publicDir
    },
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId
      }
      return null
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        const models = scanPublicModels(publicDir)
        return `export default ${JSON.stringify(models)};`
      }
      return null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), publicModelsPlugin()],
})