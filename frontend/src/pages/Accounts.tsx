import { useState } from 'react'
import { useAccounts, useCreateAccount } from '../hooks/useAccounts'
import { useToast } from '../context/ToastContext'
import type { CreateAccountPayload } from '../types'
import { AccountCard } from '../components/AccountCard'
import { Modal } from '../components/Modal'
import { CreateAccountForm } from '../components/forms/CreateAccountForm'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'

export function Accounts() {
  const { data, isLoading, error } = useAccounts()
  const createAccount = useCreateAccount()
  const { toast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)

  async function handleCreate(payload: CreateAccountPayload) {
    try {
      await createAccount.mutateAsync(payload)
      toast(`Account "${payload.name}" created!`, 'success')
      setModalOpen(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create account', 'error')
    }
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>
  )
  if (error) return <ErrorState message={(error as Error).message} />

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Header bar */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">{data?.length ?? 0} active accounts</p>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            + Add account
          </button>
        </div>

        {/* Account grid */}
        {!data?.length ? (
          <EmptyState message="No accounts yet — add one to get started" icon="🏦" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.map((account) => (
              <AccountCard key={account.id} account={account} />
            ))}
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Account">
        <CreateAccountForm onSubmit={handleCreate} loading={createAccount.isPending} />
      </Modal>
    </>
  )
}
