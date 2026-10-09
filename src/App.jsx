import { useState } from 'react';
import Library from './components/Library.jsx';
import Reader from './components/Reader.jsx';
import Spike from './components/Spike.jsx';

export default function App() {
  const [route, setRoute] = useState({ name: 'library' });

  if (!window.folio) {
    return (
      <main className="boot">
        <Spike size={28} />
        <h1>Folio</h1>
        <p>Open the Folio desktop window. The shelf lives in the app, not in a browser tab.</p>
      </main>
    );
  }

  if (route.name === 'reader') {
    return (
      <Reader
        key={route.book.id}
        book={route.book}
        onBack={() => setRoute({ name: 'library' })}
      />
    );
  }

  return (
    <Library
      onOpen={async (book) => {
        const fresh = await window.folio.getBook(book.id);
        setRoute({ name: 'reader', book: fresh || book });
      }}
    />
  );
}
