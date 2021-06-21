import { VRundown, VTemplate, InternalElement, ExternalElement, VElement, ExternalElementId } from './v-connection'
import { CommandResult, createHTTPContext, HttpMSEClient, HTTPRequestError } from './msehttp'
import { InexistentError, LocationType, PepResponse } from './peptalk'
import { MSERep } from './mse'
import { flattenEntry, AtomEntry, FlatEntry } from './xml'
import * as uuid from 'uuid'

interface ExternalElementInfo {
	vcpid: number
	channel?: string
	refName: string
}

export class Rundown implements VRundown {
	readonly show: string
	readonly playlist: string
	readonly profile: string
	readonly description: string

	private readonly mse: MSERep
	private get pep() {
		return this.mse.getPep()
	}
	private msehttp: HttpMSEClient
	private channelMap: { [id: string]: ExternalElementInfo } = {}
	private initialChannelMapPromise: Promise<any>

	constructor(mseRep: MSERep, show: string, profile: string, playlist: string, description: string) {
		this.mse = mseRep
		this.show = show.startsWith('/storage/shows/') ? show.slice(15) : show
		if (this.show.startsWith('{')) {
			this.show = this.show.slice(1)
		}
		if (this.show.endsWith('}')) {
			this.show = this.show.slice(0, -1)
		}
		this.profile = profile.startsWith('/config/profiles/') ? profile.slice(17) : profile
		this.playlist = playlist
		if (this.playlist.startsWith('{')) {
			this.playlist = this.playlist.slice(1)
		}
		if (this.playlist.endsWith('}')) {
			this.playlist = this.playlist.slice(0, -1)
		}
		this.description = description
		this.msehttp = createHTTPContext(
			this.profile,
			this.mse.resthost ? this.mse.resthost : this.mse.hostname,
			this.mse.restPort
		)
		this.initialChannelMapPromise = this.buildChannelMap().catch((err) =>
			console.error(`Warning: Failed to build channel map: ${err.message}`)
		)
	}

	private static makeKey(vcpid: number, channel?: string) {
		return `${vcpid}_${channel || ''}`
	}

	private async buildChannelMap(vcpid?: number, channel?: string): Promise<boolean> {
		if (typeof vcpid === 'number') {
			if (Object.prototype.hasOwnProperty.call(this.channelMap, Rundown.makeKey(vcpid, channel))) {
				return true
			}
		}
		await this.mse.checkConnection()
		const elements = vcpid ? [{ vcpid, channel }] : await this.listElements()
		for (const e of elements) {
			if (typeof e !== 'string') {
				const element = await this.getElement(e.vcpid, e.channel)
				this.channelMap[Rundown.makeKey(e.vcpid, e.channel)] = {
					vcpid: e.vcpid,
					channel: element.channel,
					refName:
						Object.prototype.hasOwnProperty.call(element, 'name') && typeof element.name === 'string'
							? element.name
							: 'ref',
				}
			}
		}
		return typeof vcpid === 'number'
			? Object.prototype.hasOwnProperty.call(this.channelMap, Rundown.makeKey(vcpid, channel))
			: false
	}

	private ref(vcpid: number, channel?: string): string {
		const key = Rundown.makeKey(vcpid, channel)
		return this.channelMap[key]?.refName ? this.channelMap[key].refName.replace('#', '%23') : 'ref'
	}

	async listTemplates(): Promise<string[]> {
		await this.mse.checkConnection()
		const templateList = await this.pep.getJS(`/storage/shows/{${this.show}}/mastertemplates`, 1)
		const flatTemplates = await flattenEntry(templateList.js as AtomEntry)
		return Object.keys(flatTemplates).filter((x) => x !== 'name')
	}

	async getTemplate(templateName: string): Promise<VTemplate> {
		await this.mse.checkConnection()
		const template = await this.pep.getJS(`/storage/shows/{${this.show}}/mastertemplates/${templateName}`)
		let flatTemplate = await flattenEntry(template.js as AtomEntry)
		if (Object.keys(flatTemplate).length === 1) {
			flatTemplate = flatTemplate[Object.keys(flatTemplate)[0]] as FlatEntry
		}
		return flatTemplate as VTemplate
	}

	async createElement(
		templateName: string,
		elementName: string,
		textFields: string[],
		channel?: string
	): Promise<InternalElement>
	async createElement(vcpid: number, channel?: string, alias?: string): Promise<ExternalElement>
	async createElement(
		nameOrID: string | number,
		elementNameOrChannel?: string,
		aliasOrTextFields?: string[] | string,
		channel?: string
	): Promise<VElement> {
		// TODO ensure that a playlist is created with sub-element "elements"
		if (typeof nameOrID === 'string') {
			try {
				if (elementNameOrChannel) {
					await this.getElement(elementNameOrChannel)
				}
				throw new Error(`An internal graphics element with name '${elementNameOrChannel}' already exists.`)
			} catch (err) {
				if (err.message.startsWith('An internal graphics element')) throw err
			}
			const template = await this.getTemplate(nameOrID)
			// console.dir((template[nameOrID] as any).model_xml.model.schema[0].fielddef, { depth: 10 })
			let fielddef
			if (
				Object.prototype.hasOwnProperty.call(template, 'model_xml') &&
				typeof template.model_xml === 'object' &&
				Object.prototype.hasOwnProperty.call(template.model_xml, 'model') &&
				typeof template.model_xml.model === 'object'
			) {
				fielddef = (template as any).model_xml.model.schema[0].fielddef
			} else {
				throw new Error(
					`Could not retrieve field definitions for tempalte '${nameOrID}'. Not creating element '${elementNameOrChannel}'.`
				)
			}
			let fieldNames: string[] = fielddef ? fielddef.map((x: any): string => x.$.name) : []
			let entries = ''
			const data: { [name: string]: string } = {}
			if (Array.isArray(aliasOrTextFields)) {
				if (aliasOrTextFields.length > fieldNames.length) {
					throw new Error(
						`For template '${nameOrID}' with ${fieldNames.length} field(s), ${aliasOrTextFields.length} fields have been provided.`
					)
				}
				fieldNames = fieldNames.sort()
				for (let x = 0; x < fieldNames.length; x++) {
					entries += `    <entry name="${fieldNames[x]}">${aliasOrTextFields[x] ? aliasOrTextFields[x] : ''}</entry>\n`
					data[fieldNames[x]] = aliasOrTextFields[x] ? aliasOrTextFields[x] : ''
				}
			}
			const vizProgram = channel ? ` viz_program="${channel}"` : ''
			await this.pep.insert(
				`/storage/shows/{${this.show}}/elements/${elementNameOrChannel}`,
				`<element name="${elementNameOrChannel}" guid="${uuid.v4()}" updated="${new Date().toISOString()}" creator="Sofie" ${vizProgram}>
  <ref name="master_template">/storage/shows/{${this.show}}/mastertemplates/${nameOrID}</ref>
  <entry name="default_alternatives"/>
  <entry name="data">
${entries}
  </entry>
</element>`,
				LocationType.Last
			)
			return {
				name: elementNameOrChannel,
				template: nameOrID,
				data,
				channel,
			} as InternalElement
		}
		if (typeof nameOrID === 'number') {
			try {
				await this.initialChannelMapPromise
			} catch (err) {
				console.error(`Warning: createElement: Channel map not built: ${err.message}`)
			}
			try {
				await this.getElement(nameOrID, elementNameOrChannel)
				throw new Error(`An external graphics element with name '${nameOrID}' already exists.`)
			} catch (err) {
				if (err.message.startsWith('An external graphics element')) throw err
			}
			const vizProgram = elementNameOrChannel ? ` viz_program="${elementNameOrChannel}"` : ''
			const { body: path } = await this.pep.insert(
				`/storage/playlists/{${this.playlist}}/elements/`,
				`<ref available="0.00" loaded="0.00" take_count="0"${vizProgram}>/external/pilotdb/elements/${nameOrID}</ref>`,
				LocationType.Last
			)
			this.channelMap[Rundown.makeKey(nameOrID, elementNameOrChannel)] = {
				vcpid: nameOrID,
				channel: elementNameOrChannel,
				refName: path ? path.slice(path.lastIndexOf('/') + 1) : 'ref',
			}
			return {
				vcpid: nameOrID.toString(),
				channel: elementNameOrChannel,
			} as ExternalElement
		}
		throw new Error('Create element called with neither a string or numerical reference.')
	}

	async listElements(): Promise<Array<string | ExternalElementId>> {
		await this.mse.checkConnection()
		const [showElementsList, playlistElementsList] = await Promise.all([
			this.pep.getJS(`/storage/shows/{${this.show}}/elements`, 1),
			this.pep.getJS(`/storage/playlists/{${this.playlist}}/elements`, 2),
		])
		const flatShowElements = await flattenEntry(showElementsList.js as AtomEntry)
		const elementNames: Array<string | ExternalElementId> = Object.keys(flatShowElements).filter((x) => x !== 'name')
		const flatPlaylistElements: FlatEntry = await flattenEntry(playlistElementsList.js as AtomEntry)
		const elementsRefs = flatPlaylistElements.elements
			? Object.keys(flatPlaylistElements.elements as FlatEntry).map((k) => {
					const entry = (flatPlaylistElements.elements as FlatEntry)[k] as FlatEntry
					const ref = entry.value as string
					const lastSlash = ref.lastIndexOf('/')
					return { vcpid: +ref.slice(lastSlash + 1), channel: entry.viz_program as string | undefined }
			  })
			: []
		return elementNames.concat(elementsRefs)
	}

	async activate(twice?: boolean, initShow = true, initPlaylist = true): Promise<CommandResult> {
		let result: CommandResult = {
			// Returned when initShow = false and initPlaylist = false
			path: '/',
			status: 200,
			response: 'No commands to run.',
		}
		if (twice && initShow) {
			result = await this.msehttp.initializeShow(this.show)
		}
		if (twice && initPlaylist) {
			result = await this.msehttp.initializePlaylist(this.playlist)
		}
		if (initShow) {
			result = await this.msehttp.initializeShow(this.show)
		}
		if (initPlaylist) {
			result = await this.msehttp.initializePlaylist(this.playlist)
		}
		return result
	}

	async deactivate(cleanupShow = true): Promise<CommandResult> {
		if (cleanupShow) {
			await this.msehttp.cleanupShow(this.show)
		}
		return this.msehttp.cleanupPlaylist(this.playlist)
	}

	cleanup(): Promise<CommandResult> {
		return this.msehttp.cleanupShow(this.show)
	}

	async deleteElement(elementName: string | number, channel?: string): Promise<PepResponse> {
		if (typeof elementName === 'string') {
			return this.pep.delete(`/storage/shows/{${this.show}}/elements/${elementName}`)
		} else {
			if (await this.buildChannelMap(elementName, channel)) {
				return this.pep.delete(`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`)
			} else {
				throw new InexistentError(
					-1,
					`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`
				)
			}
		}
	}

	async cue(elementName: string | number, channel?: string): Promise<CommandResult> {
		if (typeof elementName === 'string') {
			return this.msehttp.cue(`/storage/shows/{${this.show}}/elements/${elementName}`)
		} else {
			if (await this.buildChannelMap(elementName, channel)) {
				return this.msehttp.cue(`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`)
			} else {
				throw new HTTPRequestError(
					`Cannot cue external element as ID '${elementName}' is not known in this rundown.`,
					this.msehttp.baseURL,
					`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`
				)
			}
		}
	}

	async take(elementName: string | number, channel?: string): Promise<CommandResult> {
		if (typeof elementName === 'string') {
			return this.msehttp.take(`/storage/shows/{${this.show}}/elements/${elementName}`)
		} else {
			if (await this.buildChannelMap(elementName, channel)) {
				return this.msehttp.take(`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`)
			} else {
				throw new HTTPRequestError(
					`Cannot take external element as ID '${elementName}' is not known in this rundown.`,
					this.msehttp.baseURL,
					`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`
				)
			}
		}
	}

	async continue(elementName: string | number, channel?: string): Promise<CommandResult> {
		if (typeof elementName === 'string') {
			return this.msehttp.continue(`/storage/shows/{${this.show}}/elements/${elementName}`)
		} else {
			if (await this.buildChannelMap(elementName, channel)) {
				return this.msehttp.continue(`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`)
			} else {
				throw new HTTPRequestError(
					`Cannot continue external element as ID '${elementName}' is not known in this rundown.`,
					this.msehttp.baseURL,
					`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`
				)
			}
		}
	}

	async continueReverse(elementName: string | number, channel?: string): Promise<CommandResult> {
		if (typeof elementName === 'string') {
			return this.msehttp.continueReverse(`/storage/shows/{${this.show}}/elements/${elementName}`)
		} else {
			if (await this.buildChannelMap(elementName, channel)) {
				return this.msehttp.continueReverse(
					`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`
				)
			} else {
				throw new HTTPRequestError(
					`Cannot continue reverse external element as ID '${elementName}' is not known in this rundown.`,
					this.msehttp.baseURL,
					`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`
				)
			}
		}
	}

	async out(elementName: string | number, channel?: string): Promise<CommandResult> {
		if (typeof elementName === 'string') {
			return this.msehttp.out(`/storage/shows/{${this.show}}/elements/${elementName}`)
		} else {
			if (await this.buildChannelMap(elementName, channel)) {
				return this.msehttp.out(`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`)
			} else {
				throw new HTTPRequestError(
					`Cannot take out external element as ID '${elementName}' is not known in this rundown.`,
					this.msehttp.baseURL,
					`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`
				)
			}
		}
	}

	async initialize(elementName: number, channel?: string): Promise<CommandResult> {
		if (await this.buildChannelMap(elementName, channel)) {
			return this.msehttp.initialize(`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`)
		} else {
			throw new HTTPRequestError(
				`Cannot initialize external element as ID '${elementName}' is not known in this rundown.`,
				this.msehttp.baseURL,
				`/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel)}`
			)
		}
	}

	async purge(elementsToKeep?: ExternalElementId[]): Promise<PepResponse> {
		// let playlist = await this.mse.getPlaylist(this.playlist)
		// if (playlist.active_profile.value) {
		// 	throw new Error(`Cannot purge an active profile.`)
		// }
		await this.pep.replace(`/storage/shows/{${this.show}}/elements`, '<elements/>')
		if (elementsToKeep && elementsToKeep.length) {
			await this.buildChannelMap()
			const elementsSet = new Set(
				elementsToKeep.map((e) => {
					return Rundown.makeKey(e.vcpid, e.channel)
				})
			)
			for (const key in this.channelMap) {
				if (!elementsSet.has(key)) {
					try {
						await this.deleteElement(this.channelMap[key].vcpid, this.channelMap[key].channel)
					} catch (e) {
						if (!(e instanceof InexistentError)) {
							throw e
						}
					}
				}
			}
		} else {
			await this.pep.replace(`/storage/playlists/{${this.playlist}}/elements`, '<elements/>')
		}
		return { id: '*', status: 'ok' } as PepResponse
	}

	async getElement(elementName: string | number, channel?: string): Promise<VElement> {
		await this.mse.checkConnection()
		if (typeof elementName === 'number') {
			const playlistsList = await this.pep.getJS(`/storage/playlists/{${this.playlist}}/elements`, 2)
			const flatPlaylistElements: FlatEntry = await flattenEntry(playlistsList.js as AtomEntry)
			const elementKey = Object.keys(flatPlaylistElements.elements as FlatEntry).find((k) => {
				const elem = (flatPlaylistElements.elements as FlatEntry)[k] as FlatEntry
				const ref = elem.value as string
				return ref.endsWith(`/${elementName}`) && (!channel || elem.viz_program === channel)
			})
			const element =
				typeof elementKey === 'string'
					? ((flatPlaylistElements.elements as FlatEntry)[elementKey] as FlatEntry)
					: undefined
			if (!element) {
				throw new InexistentError(
					typeof playlistsList.id === 'number' ? playlistsList.id : 0,
					`/storage/playlists/{${this.playlist}}/elements#${elementName}`
				)
			} else {
				element.vcpid = elementName.toString()
				element.channel = element.viz_program
				element.name = elementKey && elementKey !== '0' ? elementKey.replace('#', '%23') : 'ref'
				return element as ExternalElement
			}
		} else {
			const element = await this.pep.getJS(`/storage/shows/{${this.show}}/elements/${elementName}`)
			const flatElement: FlatEntry = (await flattenEntry(element.js as AtomEntry))[elementName] as FlatEntry
			flatElement.name = elementName
			return flatElement as InternalElement
		}
	}

	async isActive(): Promise<boolean> {
		const playlist = await this.mse.getPlaylist(this.playlist)
		return playlist.active_profile && typeof playlist.active_profile.value !== 'undefined'
	}
}
