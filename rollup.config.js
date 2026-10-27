import alias from '@rollup/plugin-alias';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { resolve } from 'path';

const aliases = alias({
  entries: [{ find: '@', replacement: resolve(process.cwd(), 'src/main') }],
});

export default [
  {
    input: 'src/main/index.ts',
    output: [{ file: 'dist/index.js', format: 'es' }],
    external: ['react', 'react-dom'],
    plugins: [aliases, typescript({ tsconfig: './tsconfig.json' })],
  },
  {
    input: 'src/main/index.ts',
    output: [{ file: 'dist/index.d.ts', format: 'es' }],
    plugins: [aliases, dts()],
  },
  // Opt-in pricing token verification (`space-react-client/verify`). jose stays an import, so only
  // apps that use this entry point bundle it.
  {
    input: 'src/main/verify.ts',
    output: [{ file: 'dist/verify.js', format: 'es' }],
    external: ['jose'],
    plugins: [aliases, typescript({ tsconfig: './tsconfig.json' })],
  },
  {
    input: 'src/main/verify.ts',
    output: [{ file: 'dist/verify.d.ts', format: 'es' }],
    external: ['jose'],
    plugins: [aliases, dts()],
  },
];
