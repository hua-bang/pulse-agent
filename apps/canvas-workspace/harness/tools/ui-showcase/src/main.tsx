import { createRoot } from 'react-dom/client';
import { Showcase } from './Showcase';
// The real renderer's global stylesheet — defines every CSS custom
// property (--radius*, --shadow*, --surface, --border, …) the ui/ pieces
// resolve against. Importing it (rather than copying values) is what keeps
// this showcase byte-identical to the real app's chrome.
import '../../../../src/renderer/src/styles.css';
import './showcase.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(<Showcase />);
