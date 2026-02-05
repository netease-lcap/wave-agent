import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
        <h1 className="text-4xl font-bold text-blue-600 mb-4">Vite + React</h1>
        <p className="text-gray-600 mb-8">
          Now with <span className="font-semibold text-teal-500">Tailwind CSS 4.0</span>
        </p>
        
        <div className="space-y-4">
          <button 
            onClick={() => setCount((count) => count + 1)}
            className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors duration-200 shadow-md"
          >
            Count is {count}
          </button>
          
          <p className="text-sm text-gray-500">
            Edit <code className="bg-gray-100 px-1 rounded">src/App.tsx</code> and save to test HMR
          </p>
        </div>
        
        <div className="mt-8 pt-6 border-t border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-widest">
            Built with Wave Agent
          </p>
        </div>
      </div>
    </div>
  )
}

export default App
