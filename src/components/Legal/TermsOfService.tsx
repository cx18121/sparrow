import LegalPage from './LegalPage'

export default function TermsOfService() {
  return (
    <LegalPage title="Terms of Service">
      <p>By using Sparrow, you agree to these Terms of Service. Please read them carefully.</p>
      <h2 className="font-display text-base font-semibold text-dark">Use of the Service</h2>
      <p>Sparrow is provided for legitimate business outreach purposes only. You agree not to use Sparrow to send spam, harass individuals, or violate any applicable laws including CAN-SPAM, GDPR, or CASL.</p>
      <h2 className="font-display text-base font-semibold text-dark">Your Account</h2>
      <p>You are responsible for maintaining the security of your account and all activity that occurs under it. You must provide accurate information when creating your account.</p>
      <h2 className="font-display text-base font-semibold text-dark">Intellectual Property</h2>
      <p>Sparrow and its original content remain the property of its creators. Email content you create using the platform belongs to you.</p>
      <h2 className="font-display text-base font-semibold text-dark">Disclaimer</h2>
      <p>Sparrow is provided "as is" without warranties of any kind. We are not liable for the outcomes of emails sent through the platform.</p>
      <h2 className="font-display text-base font-semibold text-dark">Contact</h2>
      <p>For questions about these terms, contact us at <a href="mailto:charlie.l.xue@gmail.com" className="text-primary underline underline-offset-2">charlie.l.xue@gmail.com</a>.</p>
    </LegalPage>
  )
}
