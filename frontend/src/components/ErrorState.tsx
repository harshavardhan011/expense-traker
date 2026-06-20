interface ErrorStateProps {
  message?: string
}

export function ErrorState({ message = 'Something went wrong' }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-red-500">
      <span className="text-4xl mb-3">⚠️</span>
      <p className="text-sm">{message}</p>
    </div>
  )
}
