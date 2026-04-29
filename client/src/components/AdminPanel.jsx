import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';

async function apiFetch(url, options = {}) {
	const response = await fetch(url, {
		credentials: 'include',
		...options,
	});
	return response;
}

export default function AdminPanel({ selectedFile, onSelectFile, onLibraryChanged }) {
	const [authChecked, setAuthChecked] = useState(false);
	const [authenticated, setAuthenticated] = useState(false);
	const [password, setPassword] = useState('');
	const [rememberMe, setRememberMe] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');

	const [files, setFiles] = useState([]);
	const [selectedFilename, setSelectedFilename] = useState('');
	const [groups, setGroups] = useState([]);

	const [groupName, setGroupName] = useState('');
	const [groupPartIds, setGroupPartIds] = useState([]);
	const [editingGroupIndex, setEditingGroupIndex] = useState(null);

	const uploadRef = useRef(null);
	const replaceRef = useRef(null);

	const currentFile = useMemo(
		() => files.find((f) => f.filename === selectedFilename) || null,
		[files, selectedFilename],
	);

	const occupiedPartIds = useMemo(() => {
		const occupied = new Set();
		groups.forEach((group, idx) => {
			if (idx === editingGroupIndex) return;
			(group.partIds || []).forEach((partId) => occupied.add(partId));
		});
		return occupied;
	}, [groups, editingGroupIndex]);

	const availableParts = useMemo(() => {
		const ownParts = editingGroupIndex === null ? [] : groups[editingGroupIndex]?.partIds || [];
		const ownSet = new Set(ownParts);
		return (currentFile?.parts || []).filter(
			(part) => !occupiedPartIds.has(part.id) || ownSet.has(part.id),
		);
	}, [currentFile?.parts, editingGroupIndex, groups, occupiedPartIds]);

	useEffect(() => {
		apiFetch('/api/admin/session')
			.then((res) => res.json())
			.then((data) => {
				setAuthenticated(Boolean(data.authenticated));
				setAuthChecked(true);
			})
			.catch(() => {
				setAuthenticated(false);
				setAuthChecked(true);
			});
	}, []);

	useEffect(() => {
		if (selectedFile?.filename) {
			setSelectedFilename(selectedFile.filename);
		}
	}, [selectedFile]);

	useEffect(() => {
		if (!authenticated) return;
		loadFiles();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [authenticated]);

	useEffect(() => {
		if (!authenticated || !selectedFilename) {
			setGroups([]);
			return;
		}
		loadGroups(selectedFilename);
	}, [authenticated, selectedFilename]);

	async function loadFiles() {
		const res = await apiFetch('/api/files');
		if (!res.ok) {
			throw new Error('Failed to load sheet list');
		}
		const data = await res.json();
		setFiles(data);

		if (selectedFilename && data.some((f) => f.filename === selectedFilename)) {
			return;
		}
		const nextFilename = selectedFile?.filename && data.some((f) => f.filename === selectedFile.filename)
			? selectedFile.filename
			: data[0]?.filename || '';
		setSelectedFilename(nextFilename);
		if (nextFilename) {
			onSelectFile?.(data.find((f) => f.filename === nextFilename));
		} else {
			onSelectFile?.(null);
		}
	}

	async function loadGroups(filename) {
		const res = await apiFetch(`/api/groups/${encodeURIComponent(filename)}`);
		if (!res.ok) {
			setGroups([]);
			return;
		}
		const data = await res.json();
		setGroups(Array.isArray(data.groups) ? data.groups : []);
		resetGroupForm();
	}

	function resetGroupForm() {
		setGroupName('');
		setGroupPartIds([]);
		setEditingGroupIndex(null);
	}

	async function handleLogin(event) {
		event.preventDefault();
		setBusy(true);
		setError('');
		setNotice('');
		try {
			const res = await apiFetch('/api/admin/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password, rememberMe }),
			});
			const data = await res.json();
			if (!res.ok) {
				throw new Error(data.error || 'Login failed');
			}
			setAuthenticated(true);
			setPassword('');
			setNotice('Admin session is active.');
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy(false);
		}
	}

	async function handleLogout() {
		setBusy(true);
		setError('');
		setNotice('');
		try {
			await apiFetch('/api/admin/logout', { method: 'POST' });
		} finally {
			setAuthenticated(false);
			setGroups([]);
			setBusy(false);
			setNotice('Logged out.');
		}
	}

	async function handleUpload() {
		const file = uploadRef.current?.files?.[0];
		if (!file) {
			setError('Choose a file to upload.');
			return;
		}

		setBusy(true);
		setError('');
		setNotice('');
		try {
			const body = new FormData();
			body.append('file', file);

			const res = await apiFetch('/api/admin/files', { method: 'POST', body });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Upload failed');

			setNotice(`Uploaded ${data.filename}`);
			uploadRef.current.value = '';
			await loadFiles();
			setSelectedFilename(data.filename);
			onSelectFile?.(data);
			onLibraryChanged?.();
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy(false);
		}
	}

	async function handleReplace() {
		const file = replaceRef.current?.files?.[0];
		if (!selectedFilename) {
			setError('Select a sheet to replace.');
			return;
		}
		if (!file) {
			setError('Choose a replacement file.');
			return;
		}

		setBusy(true);
		setError('');
		setNotice('');
		try {
			const body = new FormData();
			body.append('file', file);

			const res = await apiFetch(`/api/admin/files/${encodeURIComponent(selectedFilename)}`, {
				method: 'PUT',
				body,
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Replace failed');

			replaceRef.current.value = '';
			setNotice(`Replaced ${data.filename}`);
			await loadFiles();
			await loadGroups(data.filename);
			onSelectFile?.(data);
			onLibraryChanged?.();
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy(false);
		}
	}

	async function handleDelete() {
		if (!selectedFilename) {
			setError('Select a sheet to delete.');
			return;
		}
		if (!globalThis.confirm(`Delete ${selectedFilename}? This also removes its part groups.`)) {
			return;
		}

		setBusy(true);
		setError('');
		setNotice('');
		try {
			const res = await apiFetch(`/api/admin/files/${encodeURIComponent(selectedFilename)}`, {
				method: 'DELETE',
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Delete failed');

			setNotice(`Deleted ${selectedFilename}`);
			await loadFiles();
			onLibraryChanged?.();
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy(false);
		}
	}

	async function persistGroups(nextGroups) {
		if (!selectedFilename) {
			throw new Error('No sheet selected');
		}

		const res = await apiFetch(`/api/admin/groups/${encodeURIComponent(selectedFilename)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ groups: nextGroups }),
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error || 'Failed to save groups');
		setGroups(data.groups || []);
	}

	async function handleSaveGroup() {
		if (!selectedFilename) {
			setError('Select a sheet first.');
			return;
		}

		const name = groupName.trim();
		if (!name) {
			setError('Group name is required.');
			return;
		}
		if (groupPartIds.length < 2) {
			setError('A group must contain at least two parts.');
			return;
		}

		setBusy(true);
		setError('');
		setNotice('');
		try {
			const nextGroups = groups.map((group) => ({ ...group }));
			const candidate = { name, partIds: [...new Set(groupPartIds)] };

			if (editingGroupIndex === null) {
				nextGroups.push(candidate);
			} else {
				nextGroups[editingGroupIndex] = candidate;
			}

			await persistGroups(nextGroups);
			setNotice('Group configuration saved.');
			resetGroupForm();
			onLibraryChanged?.();
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy(false);
		}
	}

	async function handleDeleteGroup(index) {
		const group = groups[index];
		if (!group) return;
		if (!globalThis.confirm(`Delete group ${group.name}?`)) return;

		setBusy(true);
		setError('');
		setNotice('');
		try {
			const nextGroups = groups.filter((_g, idx) => idx !== index);
			await persistGroups(nextGroups);
			setNotice(`Deleted group ${group.name}`);
			if (editingGroupIndex === index) resetGroupForm();
			onLibraryChanged?.();
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy(false);
		}
	}

	function startEditGroup(index) {
		const group = groups[index];
		if (!group) return;
		setEditingGroupIndex(index);
		setGroupName(group.name);
		setGroupPartIds(group.partIds || []);
		setError('');
		setNotice('');
	}

	function toggleGroupPart(partId) {
		setGroupPartIds((prev) => (
			prev.includes(partId)
				? prev.filter((id) => id !== partId)
				: [...prev, partId]
		));
	}

	if (!authChecked) {
		return <div className="admin-panel"><p>Checking admin session…</p></div>;
	}

	if (!authenticated) {
		return (
			<div className="admin-panel">
				<div className="admin-card admin-login-card">
					<h2>Admin Login</h2>
					<p className="admin-subtitle">Enter the shared admin password to manage sheets.</p>
					<form onSubmit={handleLogin} className="admin-form">
						<label htmlFor="admin-password">Password</label>
						<input
							id="admin-password"
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							disabled={busy}
							autoComplete="current-password"
						/>
						<label className="checkbox-row">
							<input
								type="checkbox"
								checked={rememberMe}
								onChange={(event) => setRememberMe(event.target.checked)}
								disabled={busy}
							/>
							<span>Remember me for 7 days</span>
						</label>
						<button type="submit" className="btn btn-primary" disabled={busy || !password.trim()}>
							{busy ? 'Signing in…' : 'Sign In'}
						</button>
					</form>
					{error && <p className="admin-error">{error}</p>}
					{notice && <p className="admin-notice">{notice}</p>}
				</div>
			</div>
		);
	}

	return (
		<div className="admin-panel">
			<div className="admin-toolbar">
				<h2>Admin Dashboard</h2>
				<button type="button" className="btn btn-secondary" onClick={handleLogout} disabled={busy}>
					Log Out
				</button>
			</div>

			{(error || notice) && (
				<div className="admin-status-wrap">
					{error && <p className="admin-error">{error}</p>}
					{notice && <p className="admin-notice">{notice}</p>}
				</div>
			)}

			<div className="admin-grid">
				<section className="admin-card">
					<h3>Sheet Operations</h3>
					<div className="admin-op-block">
						<label htmlFor="admin-upload-file">Upload New Sheet</label>
						<input id="admin-upload-file" ref={uploadRef} type="file" accept=".xml,.musicxml,.mxl" disabled={busy} />
						<button type="button" className="btn btn-primary" onClick={handleUpload} disabled={busy}>
							Upload
						</button>
					</div>

					<div className="admin-op-block">
						<label htmlFor="admin-selected-sheet">Selected Sheet</label>
						<select
							id="admin-selected-sheet"
							value={selectedFilename}
							onChange={(event) => {
								const filename = event.target.value;
								setSelectedFilename(filename);
								const next = files.find((f) => f.filename === filename) || null;
								onSelectFile?.(next);
							}}
							disabled={busy || files.length === 0}
						>
							{files.length === 0 && <option value="">No sheets available</option>}
							{files.map((file) => (
								<option key={file.filename} value={file.filename}>{file.title} ({file.filename})</option>
							))}
						</select>
					</div>

					<div className="admin-op-block">
						<label htmlFor="admin-replace-file">Replace Selected Sheet</label>
						<input id="admin-replace-file" ref={replaceRef} type="file" accept=".xml,.musicxml,.mxl" disabled={busy || !selectedFilename} />
						<button type="button" className="btn btn-secondary" onClick={handleReplace} disabled={busy || !selectedFilename}>
							Replace
						</button>
					</div>

					<div className="admin-op-block danger-zone">
						<button type="button" className="btn btn-danger" onClick={handleDelete} disabled={busy || !selectedFilename}>
							Delete Selected Sheet
						</button>
					</div>
				</section>

				<section className="admin-card">
					<h3>Group Manager</h3>
					{!currentFile && <p className="admin-subtitle">Select a sheet to configure grouped parts.</p>}
					{currentFile && (
						<>
							<p className="admin-subtitle">
								Grouped controls for: <strong>{currentFile.title}</strong>
							</p>
							<ul className="group-list">
								{groups.map((group, index) => (
									<li key={`${group.name}-${index}`} className="group-item">
										<div>
											<div className="group-name">{group.name}</div>
											<div className="group-meta">{group.partIds.join(', ')}</div>
										</div>
										<div className="group-actions">
											<button type="button" className="btn btn-mini" onClick={() => startEditGroup(index)} disabled={busy}>Edit</button>
											<button type="button" className="btn btn-mini btn-danger" onClick={() => handleDeleteGroup(index)} disabled={busy}>Delete</button>
										</div>
									</li>
								))}
								{groups.length === 0 && <li className="admin-subtitle">No groups configured yet.</li>}
							</ul>

							<div className="group-editor">
								<h4>{editingGroupIndex === null ? 'Create Group' : 'Edit Group'}</h4>
								<label htmlFor="group-name">Group Name</label>
								<input
									id="group-name"
									value={groupName}
									onChange={(event) => setGroupName(event.target.value)}
									disabled={busy}
								/>
								<p className="admin-subtitle">Select at least two parts (parts cannot overlap between groups).</p>
								<div className="group-parts-list">
									{availableParts.map((part) => (
										<label key={part.id} className="checkbox-row">
											<input
												type="checkbox"
												checked={groupPartIds.includes(part.id)}
												onChange={() => toggleGroupPart(part.id)}
												disabled={busy}
											/>
											<span>{part.name || part.id} ({part.id})</span>
										</label>
									))}
								</div>
								<div className="group-editor-actions">
									<button type="button" className="btn btn-primary" onClick={handleSaveGroup} disabled={busy || !currentFile}>
										{editingGroupIndex === null ? 'Create Group' : 'Save Group'}
									</button>
									<button type="button" className="btn btn-secondary" onClick={resetGroupForm} disabled={busy}>
										Reset
									</button>
								</div>
							</div>
						</>
					)}
				</section>
			</div>
		</div>
	);
}

AdminPanel.propTypes = {
	selectedFile: PropTypes.shape({
		filename: PropTypes.string,
		title: PropTypes.string,
		parts: PropTypes.arrayOf(
			PropTypes.shape({
				id: PropTypes.string,
				name: PropTypes.string,
			}),
		),
	}),
	onSelectFile: PropTypes.func,
	onLibraryChanged: PropTypes.func,
};
