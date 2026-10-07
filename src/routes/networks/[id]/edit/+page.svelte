<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { enhance } from '$app/forms';
	import { enhanceWithFocus } from '$lib/forms';
	import Field from '$lib/components/app/field.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	let { data, form } = $props();
	const values = $derived(form?.values ?? data.person);
	const errors = $derived(form?.errors ?? {});
	const back = $derived(`/networks/${data.person.id}`);
</script>

<svelte:head><title>Edit details · Saturday</title></svelte:head>
<div class="mx-auto max-w-2xl space-y-8">
	<div class="space-y-4">
		<a class="back-link" href={back}><ArrowLeft class="size-4" />Back to person</a><PageHeader
			title="Edit details"
			description="Update this person's contact details and notes."
		/>
	</div>

	{#if errors.form}<Notice tone="error" title="Person not saved">{errors.form}</Notice
		>{:else if Object.keys(errors).length}<Notice
			tone="error"
			title="Check the highlighted fields"
		/>{/if}
	<form method="POST" use:enhance={enhanceWithFocus} class="space-y-6">
		<p class="text-sm text-muted-foreground">
			<span class="text-destructive" aria-hidden="true">*</span> Required
		</p>
		<Card.Root
			><Card.Content class="space-y-5 py-2">
				<Field id="name" label="Name" required error={errors.name}
					>{#snippet control(attrs)}<Input
							{...attrs}
							name="name"
							type="text"
							maxlength={200}
							value={values.name ?? ''}
						/>{/snippet}</Field
				>
				<Field id="role" label="Role" error={errors.role}
					>{#snippet control(attrs)}<Input
							{...attrs}
							name="role"
							type="text"
							maxlength={200}
							value={values.role ?? ''}
						/>{/snippet}</Field
				>
				<Field id="organization" label="Organization" error={errors.organization}
					>{#snippet control(attrs)}<Input
							{...attrs}
							name="organization"
							type="text"
							maxlength={200}
							value={values.organization ?? ''}
						/>{/snippet}</Field
				>
				<Field id="phone" label="Phone" error={errors.phone}
					>{#snippet control(attrs)}<Input
							{...attrs}
							name="phone"
							type="tel"
							maxlength={100}
							value={values.phone ?? ''}
						/>{/snippet}</Field
				>
				<Field id="email" label="Email" error={errors.email}
					>{#snippet control(attrs)}<Input
							{...attrs}
							name="email"
							type="email"
							maxlength={320}
							value={values.email ?? ''}
						/>{/snippet}</Field
				>
				<Field id="link" label="Profile or website" error={errors.link}
					>{#snippet control(attrs)}<Input
							{...attrs}
							name="link"
							type="url"
							maxlength={2000}
							value={values.link ?? ''}
						/>{/snippet}</Field
				>
				<Field id="notes" label="Notes" error={errors.notes}
					>{#snippet control(attrs)}<Textarea
							{...attrs}
							name="notes"
							rows={5}
							maxlength={20000}
							value={values.notes ?? ''}
						/>{/snippet}</Field
				>
			</Card.Content></Card.Root
		>

		<div class="form-actions flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
			<Button href={back} variant="ghost" size="lg">Cancel</Button><Button type="submit" size="lg"
				>Save person</Button
			>
		</div>
	</form>
</div>
