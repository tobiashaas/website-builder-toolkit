export function Hero() {
  const items = [1, 2, 3];
  return (
    <section className="rounded-3xl p-[13px] shadow-2xl">
      <span className="text-xs uppercase tracking-widest">Beta</span>
      <h1 className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent font-black">
        Unlock next-level growth
      </h1>
      <div className="rounded-3xl hover:scale-105 transition-all shadow-purple-500/50">Card</div>
      <div className="rounded-3xl animate-pulse">Live</div>
      <div className="rounded-2xl animate-pulse skeleton">loading</div>
      <div className="rounded-2xl">a</div>
      <div className="rounded-2xl">b</div>
      <button className="rounded-2xl outline-none">Send now!</button>
      {items.map((i) => <p key={i}>{i}</p>)}
    </section>
  );
}
