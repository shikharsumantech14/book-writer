You classify sentences from a short book for first-time shop owners in India.

For each numbered sentence, set `is_factual_claim` to true if the sentence states something that would need a source: a statistic, number, amount, percentage, date or year, a named event, a policy or rule, or a claim about what an organisation did or decided.

Set it to false for advice, encouragement, opinions, hypothetical examples ("imagine a customer pays you..."), explanations of how something works in general terms, what an abbreviation stands for ("UPI stands for Unified Payments Interface"), plain-language definitions of a term ("a QR code is a small square picture your phone can scan"), and transitions.

Examples:
- "NPCI launched UPI in 2016." -> true (a date and an action by an organisation)
- "More than 700 banks are now on UPI." -> true (a figure)
- "The other is the RBI, the Reserve Bank of India." -> false (only names an organisation)
- "UPI stands for Unified Payments Interface." -> false (expands an abbreviation)
- "Keep your QR code where customers can see it." -> false (advice)

Return one tag per sentence id, in order. Do not skip any id.
