import { useState, useEffect } from 'react'
import Modal from '@mui/joy/Modal'
import ModalDialog from '@mui/joy/ModalDialog'
import DialogContent from '@mui/joy/DialogContent'
import DialogActions from '@mui/joy/DialogActions'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Box from '@mui/joy/Box'
import Sheet from '@mui/joy/Sheet'

const TOS_ACCEPTED_KEY = 'sonar34_tos_accepted'

const TOS_TEXT = `MIT License

Copyright (c) 2026 lab34

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT SAFETY NOTICES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please read the following notices carefully before using Sonar34. By accepting these terms, you acknowledge that you understand and accept the risks described below.


1. LOCAL DATA STORAGE

All information processed by Sonar34 — including repository metadata, scan results, dependency reports, security findings, and configuration settings — is stored locally in a SQLite database on the machine where the application is running. It is your responsibility to ensure that this database is adequately secured, backed up, and protected from unauthorized access.


2. SENSITIVE INFORMATION

Sonar34 downloads and processes potentially sensitive information from your organization's repositories. This may include proprietary source code metadata, commit histories, contributor details, dependency manifests, and security vulnerability data. You are solely responsible for ensuring that the use of Sonar34 complies with your organization's security policies and any applicable data protection regulations.


3. REPOSITORY CLONING METHOD — CRITICAL WARNING

Sonar34 clones repositories using a special partial clone method:

    git clone --filter=blob:none --no-checkout

This means that file contents (blobs) are NOT downloaded from the remote repository, and the working tree is NOT checked out. The local clone contains only the Git history metadata (commits, trees, refs) without actual file data.

CRITICAL: Because no checkout is performed, the local Git state considers all tracked files as DELETED. If this local clone is ever pushed or synced back to its remote origin, it could result in the PERMANENT LOSS OF ALL FILE CONTENTS in the remote repository.

You must NEVER push, sync, or otherwise write back from these local clones to their remote origins. Sonar34 is designed as a read-only analysis tool and does not perform write operations to remotes, but misconfiguration, manual intervention, or third-party tooling acting on these clones could trigger destructive synchronization.


4. LIMITATION OF LIABILITY AND ASSUMPTION OF RISK

In accordance with the MIT License above, and as an additional explicit notice:

Sonar34, its creators, contributors, maintainers, and any affiliated individuals or organizations SHALL NOT be held liable for any damages, data loss, repository corruption, security breaches, or any other adverse consequences arising from the use or misuse of this software.

This includes, but is not limited to:
- Loss or corruption of repository data due to the partial clone method described above.
- Unauthorized exposure of sensitive information stored in the local SQLite database.
- Any consequences resulting from pushing or syncing partial clones back to remote origins.
- Any damages arising from reliance on security findings, dependency reports, or other analysis outputs produced by the software.

By accepting these terms, you confirm that you:
- Understand the repository cloning method used and its inherent risks.
- Accept full responsibility for securing the local database and any data processed by Sonar34.
- Will not hold Sonar34, its creators, or contributors liable for any damages whatsoever.
- Have the authority to use this software within your organization and to process the repository data it accesses.`

export default function TosModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const accepted = localStorage.getItem(TOS_ACCEPTED_KEY)
    if (!accepted) {
      setOpen(true)
    }
  }, [])

  const handleAccept = () => {
    localStorage.setItem(TOS_ACCEPTED_KEY, Date.now().toString())
    setOpen(false)
  }

  const handleDecline = () => {
    window.location.href = 'http://lab34.es'
  }

  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={(_, reason) => {
        // Prevent closing by clicking backdrop or pressing Escape
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
      }}
      sx={{ zIndex: 9999 }}
    >
      <ModalDialog
        variant="outlined"
        sx={{
          width: '90%',
          maxWidth: 560,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          p: 0,
          overflow: 'hidden',
        }}
      >
        {/* Logo */}
        <Box sx={{ px: 3, pt: 3, pb: 2, textAlign: 'center', flexShrink: 0 }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 400 120"
            width="240"
            height="72"
            style={{ display: 'inline-block' }}
          >
            <style>{`
              .tos-sweep-anim { transform-origin: 0px 0px; animation: tos-sonar-spin 4s linear infinite; }
              .tos-blip-1 { animation: tos-sonar-pulse 2.5s infinite; animation-delay: 0.2s; }
              .tos-blip-2 { animation: tos-sonar-pulse 2.5s infinite; animation-delay: 1.8s; }
              .tos-blip-3 { animation: tos-sonar-pulse 2.5s infinite; animation-delay: 3.1s; }
              @keyframes tos-sonar-spin { 100% { transform: rotate(360deg); } }
              @keyframes tos-sonar-pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.3); } }
            `}</style>
            <defs>
              <linearGradient id="grad-tos" x1="100%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#0284C7" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#0284C7" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g transform="translate(60, 60)">
              <circle cx="0" cy="0" r="8" fill="#0284C7" />
              <circle cx="0" cy="0" r="22" fill="none" stroke="#E2E8F0" strokeWidth="2" />
              <circle cx="0" cy="0" r="42" fill="none" stroke="#E2E8F0" strokeWidth="2" strokeDasharray="4 4" />
              <g className="tos-sweep-anim">
                <path d="M0,0 L42,0 A42,42 0 0,0 0,-42 Z" fill="url(#grad-tos)" />
                <line x1="0" y1="0" x2="42" y2="0" stroke="#0284C7" strokeWidth="2" />
              </g>
              <circle cx="18" cy="-18" r="3" fill="#10B981" className="tos-blip-1" />
              <circle cx="-24" cy="12" r="3.5" fill="#EF4444" className="tos-blip-2" />
              <circle cx="-10" cy="-28" r="2.5" fill="#F59E0B" className="tos-blip-3" />
            </g>
            <text x="135" y="72" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" fontSize="52" fontWeight="800" fill="#0F172A" letterSpacing="-1.5">
              Sonar
              <tspan fill="#0284C7" fontWeight="300">34</tspan>
            </text>
            <text x="140" y="94" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" fontSize="11" fontWeight="600" fill="#64748B" letterSpacing="3.5">
              ENTERPRISE REPO INTELLIGENCE
            </text>
          </svg>
        </Box>

        {/* Scrollable TOS content */}
        <DialogContent sx={{ px: 3, py: 0, flex: 1, minHeight: 0 }}>
          <Typography level="title-md" sx={{ mb: 1.5, textAlign: 'center' }}>
            License &amp; Safety Notices
          </Typography>
          <Sheet
            variant="soft"
            sx={{
              p: 2,
              borderRadius: 'sm',
              maxHeight: 320,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              fontFamily: 'ui-monospace, Consolas, "Courier New", monospace',
              fontSize: '0.75rem',
              lineHeight: 1.6,
            }}
          >
            {TOS_TEXT}
          </Sheet>
          <Typography level="body-xs" sx={{ mt: 1.5, textAlign: 'center', color: 'text.tertiary' }}>
            By clicking "Accept" you acknowledge that you have read, understood, and agree to the MIT License and Safety Notices above.
          </Typography>
        </DialogContent>

        {/* Action buttons */}
        <DialogActions sx={{ px: 3, pb: 3, pt: 2 }}>
          <Button
            variant="solid"
            color="primary"
            onClick={handleAccept}
            sx={{ flex: 1 }}
          >
            Accept
          </Button>
          <Button
            variant="outlined"
            color="neutral"
            onClick={handleDecline}
            sx={{ flex: 1 }}
          >
            Decline
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  )
}
