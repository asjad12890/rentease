export default function Spinner({ small }) {
  return (
    <span
      className={`inline-block border-2 border-current border-t-transparent rounded-full animate-spin ${
        small ? 'w-4 h-4' : 'w-5 h-5'
      }`}
    />
  );
}
