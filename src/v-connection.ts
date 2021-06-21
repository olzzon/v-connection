/**
 *  Interfaces for controlling Vizrt Media Sequencer Engine from Node.js applications.
 *
 *  Intended usage pattern:
 *  1. Create an [[MSE]] instance to manage all communications with the MSE server.
 *  2. Discover the details of availale [[VShow|shows]], [[VizEngine|Viz Engines]]
 *     and [[VProfile|profiles]]. TODO create a profile?
 *  3. Use the MSE to create [[VRundown|rundowns]] that link shows to profiles.
 *  4. Add all the [[VElement|graphical elements]] used in a show.
 *  5. Activate a rundown and send commands to take graphics in and out.
 *  6. Deactivate a rundown and finally purge all associated elements and state.
 */

import { EventEmitter } from 'events'
import { CommandResult } from './msehttp'
import { PepResponse } from './peptalk'
import { FlatEntry } from './xml'

/**
 *  Representation of the schema for a single data field in a master template.
 */
export interface VModelField {
	// Needs some work to deal with images
	/**
	 *  Unique name of the element within its schema. This element is often - but
	 *  not always - a number or at least two digits, e.g. `06` rather than `6`.
	 *  VDF-based templates use string names.
	 */
	name: string
	/** Default value(s) for the element. */
	value: string | string[]
	/**
	 *  Label for the element, used for display in some GUIs. Note that more than
	 *  field may have the same label.
	 */
	label: string
	/** Field must be displayed on a single line? */
	singleline?: boolean
	/** Field must be displayed with uppercase characeters? */
	uppercase?: boolean
	/** MIME-type for the data element. Typically `application/vnd.vizrt.richtext+xml`. */
	mediatype: string
	/** Internal detail of hoe to communicate with the Viz Engine about this element. */
	container?: {
		uuid: string
		path: string
	}
}

/**
 *  Represenatation of a _master template_ within a [[VShow|show]].
 */
export interface VTemplate extends FlatEntry {
	/** Master template name. */
	name: string
	/** Representation of the `default_alternatives` structure. Not in use. */
	defaultAlternatives: any
	/** Reference to _scene selectors_ used by this _master template_. */
	// TODO make this FlatEntry compatible
	// layers: {
	// 	ref: string | string[]
	// 	// TODO more detailed references, such as ALL_OUT templates
	// }
	// /** Schema describing the expected data fields. */
	// modelXML?: VModelField[]
}

/**
 *  An instance of a graphical element that can be displayed and/or used to
 *  influence the graphical behaviour of a running show.
 */
export interface VElement extends FlatEntry {
	/** Optional channel specifier used to define which Viz Engines the graphics play on.
	 *  Note when `undefined`, the default is the _program_ channel.
	 */
	channel?: string
}

/** Graphical element that is fully described within the VDOM tree. */
export interface InternalElement extends VElement {
	/** Name of the specific element. Should be built before the element is taken. */
	name: string
	/** Name of the [[VTemplate|master template]] used by this element. */
	template: string
	/** Name/value pairs containing the data for each field of the template. */
	data: { [name: string]: string }
}

/** Graphical element that is defined externally, e.g. in the pilot database. */
export interface ExternalElement extends VElement {
	/** Unique identifier for the template in the external system. */
	vcpid: string // TODO this should really be a number
	/** Set to `1.00` if the element is available. May be omitted or `0.00`. */
	available?: string
	/** Set to `yes` if the element is loading onto the associated VizEgnine, otherwise omitted. */
	is_loading?: string
	/** Set to `0.00` if the element is not loaded onto the associated VizEngine,
	 *  `1.00` if it is loaded and a number between 0 and 1 to indicate loading progress.
	 *  Omitted if owning playlist is not active.
	 */
	loaded?: string
	/** Number of times the element has been taken, or omitted if the playlist is
	 *  not active.
	 */
	take_count?: string
	/** Set to `no` if the element has not been built from the database by the MSE, otherwise omitted. */
	exists?: string
	/** Set to an error message if there is a problem with this grahic. This often
	 *  happens because the element is not available in the database.
	 */
	error?: string
	/** Reference name of element references. Will be `ref`, `ref#1`, `ref#2` etc.. */
	name?: string
}

/** Object uniquely identifying an external element loaded into an Engine */
export interface ExternalElementId {
	/** Unique identifier for the template in the external system. */
	vcpid: number
	/** Optional channel specifier used to define which Viz Engines the graphics play on.
	 *  Note when `undefined`, the default is the _program_ channel.
	 */
	channel?: string
}

/**
 *  Representation of all the graphics associated with a Sofie rundown. A rundown object is
 *  created to link a [[VShow|show]] full of templates with a profile that is the target of
 *  commands sent to that show.
 *
 *  External elements can be named using an optional alias and either their identifier or the
 *  alias can be used to send that command.
 */
export interface VRundown {
	/** Identifier for the show containing the [[VTemplate|master templates]] associated with this rundown. */
	readonly show: string
	/** Identifier for the playlist built specifically for this rundown. */
	readonly playlist: string
	/** Identifier for the profile that is the targer for commands, the link to the Viz Engines being. */
	readonly profile: string
	/** Optional description of the rundown. Used as a name for the playlist in Viz Content Pilot. */
	readonly description?: string
	/**
	 *  List all the master templates associated with this rundown.
	 *  @returns Resolves to a list of all template names for this rundown.
	 */
	listTemplates(): Promise<string[]>
	/**
	 *  Read details of a specific [[VTemplate|template]].
	 *  @param templateName Name of the emplate to retrieve the elements from,
	 *                      e.g. `bund`.
	 *  @returns Resolves to the details of the named template.
	 */
	getTemplate(templateName: string): Promise<VTemplate>
	/**
	 *  Create a new [[InternalElement|_internal_ graphical element]] that is an
	 *  instance of the named [[VTemplate|template]].
	 *  @param templateName Name of the template the element is an instance of.
	 *  @param elementName  Name of the graphical element to create.
	 *  @param textFields   List of values for each of the graphical elements.
	 *  @param channel      Optional channel to play out this graphic. Default is the _program_.
	 *  @returns Resolves to a newly created element.
	 */
	createElement(
		templateName: string,
		elementName: string,
		textFields: string[],
		channel?: string
	): Promise<InternalElement>
	/**
	 *  Create a new [[ExternalElement|_external_ graphical element]] by unique reference number.
	 *  @param vcpid Unique reference number for the element in the external source,
	 *               e.g. a pilot database.
	 *  @param alias Optional name to use to reference the element. Note that this
	 *               name is stored only within the library and not persisted in
	 *               the MSE.
	 *  @param channel Optional channel to play out this graphic. Default is the _program_.
	 *  @returns Resolves to a newly created element reference.
	 */
	createElement(vcpid: number, channel?: string, alias?: string): Promise<ExternalElement>
	/**
	 *  List all the graphical elements created for this rundown.
	 *  @returns Resolves to a list of graphical element names or references for this rundown.
	 */
	listElements(): Promise<Array<string | ExternalElementId>>
	/**
	 *  Read the details of a graphical element in this rundown.
	 *  @param elementName Name or reference (vcpid) for the element to retrieve the details
	 *                     for.
	 *  @param channel Optional channel to play out this graphic. Default is the _program_.
	 *  @returns Resolves to provide the details of the named element.
	 */
	getElement(elementName: string | number, channel?: string): Promise<VElement>
	/**
	 *  Delete a graphical element from the rundown.
	 *  @param elementName Name or reference (vcpid) for the element to delete.
	 *  @param channel Optional channel to play out this graphic. Default is the _program_.
	 *  @returns Resolves to indicate the delete was successful, otherwise rejects.
	 */
	deleteElement(elementName: string | number, channel?: string): Promise<PepResponse>
	/**
	 *  Send a _cue_ command for a named graphical element, preparing it for smooth display.
	 *  @param elementName Name or reference (vcpid) for the gephical element to cue.
	 *  @param channel Optional channel to play out this graphic. Default is the _program_.
	 *  @returns Resolves on acceptance of the cue command.
	 */
	cue(elementName: string | number, channel?: string): Promise<CommandResult>
	/**
	 *  Send a _take_ command for a named graphical element, requesting that it is displayed.
	 *  @param elementName Name or reference (vcpid) for the gephical element to take in.
	 *  @param channel Optional channel to play out this graphic. Default is the _program_.
	 *  @returns Resolves on acceptance of the take command.
	 */
	take(elementName: string | number, channel?: string): Promise<CommandResult>
	/**
	 *  Send a _continue_ command for a named graphical element, causing the next
	 *  presentation state is to be displayed.
	 *  @param elementName Name or reference (vcpid) for the gephical element to continue.
	 *  @param channel Optional channel to play out this graphic. Default is the _program_.
	 *  @returns Resolves on acceptance of the continue command.
	 */
	continue(elementName: string | number, channel?: string): Promise<CommandResult>
	/**
	 *  Send a _continue-reverse_ command for a named graphical element, causing the
	 *  previous presentation state is to be displayed.
	 *  @param elementName Name or reference (vcpid) for the gephical element to continue.
	 *  @param channel Optional channel to play out this graphic. Default is the _program_.
	 *  @returns Resolves on acceptance of the continue command.
	 */
	continueReverse(elementName: string | number, channel?: string): Promise<CommandResult>
	/**
	 *  Send an _out_ command for the named graphical element, ending its ongoing
	 *  display.
	 *  @param elementName Name or reference (vcpid) for the graphical element to take-out.
	 *  @param channel Optional channel to play out this graphic. Default is the _program_.
	 *  @return Resolves on acceptance of the take-out command.
	 */
	out(elementName: string | number, channel?: string): Promise<CommandResult>
	/**
	 *  Run the initiaization of an external graphic element. This will cause the
	 *  element to load all necessary resources onto the assiciated VizEngine ready
	 *  to be taken. Watch for `loaded="1.00"` in the element reference in the
	 *  playlist to know when it is safe to take the element.
	 *  @param vcpid Reference for the graphical element to initialize.
	 *  @param channel Optional channel to play out this graphic. Default is the _program_.
	 *  @returns Resolves on acceptance of the initialize command. Note that this
	 *           is not when the element finishes loading on the VizEngine.
	 */
	initialize(vcpid: number, channel?: string): Promise<CommandResult>
	/**
	 *  Activate a rundown, causing all initialisations to be requested prior to
	 *  the execution of a rundown. Note that experimentation has shown that it
	 *  can be necessary to call this method a couple of times, spaces a few seconds
	 *  apart.
	 *  @param twice        Trigger the activations twice, which may cause
	 *                      graphical elements to start loading.
	 *  @param initShow     Initialize the show containing internal elements. This
	 *                      defaults to `true`.
	 *  @param initPlaylist Initialize the playlist containing external elements.
	 *                      This defaults to `true`.
	 *  @returns Resolves on successful rundown activation. Rejects if any step
	 *           fails.
	 */
	activate(twice?: boolean, initShow?: boolean, initPlaylist?: boolean): Promise<CommandResult>
	/**
	 *  Deactivate a rundown, cleaning up any transient elements associated with
	 *  the rundown from the VDOM tree. Those XML elements required for post-rundown
	 *  analysis will remain.
	 *  @param cleanupShow Also cleanup the associated show. The default is true.
	 *  @result Resolves on successful rundown deactivation.
	 */
	deactivate(cleanupShow?: boolean): Promise<CommandResult>
	/**
	 *  Cleanup the show and all associated renderers. This may be necessary if the
	 *  state of the VizEngine is in a bad or in some way out of step with the automation
	 *  system.
	 *  @returns Resolves on a successful request to cleanup.
	 */
	cleanup(): Promise<CommandResult>
	/**
	 *  Clear up all graphical elements and state associated with a rundown,
	 *  including those required for post-rundown analysis.
	 *  @result Resolves on successful rundown purge.
	 */
	purge(elementsToKeep?: ExternalElementId[]): Promise<PepResponse>
	/**
	 *  Is the associated MSE playlist currently active?
	 *  @returns Resolves with the activation status of the associated MSE playlist.
	 */
	isActive(): Promise<boolean>
}

/**
 *  Represenation of a connection and state of a Viz Engine.
 */
export interface VizEngine extends FlatEntry {
	readonly instance?: string
	readonly mode: string
	readonly resolved_ip?: string
	/** Status of the Viz Engine accoridng to the MSE handler. */
	readonly status: string
	readonly type: 'viz'
	readonly name: string
	readonly encoding: { value: string }
	readonly state: any // TODO flesh out depth
	readonly renderer: { [hostname: string]: { [status: string]: any } }
	readonly publishing_point_uri: any
	readonly publishing_point_atom_id: any
	readonly info: any
}

/**
 *  Representation of a MSE profile.
 */
export interface VProfile extends FlatEntry {
	/** Name of the profile, used as the target of commands. */
	name: string
	// TODO add other profile details
	// handlers
	// playlist_state
	execution_groups: {
		[group: string]: VExecutionGroup
	}
	// cursorstate
	// cursors - element - gui
	// program - vix - video
	// directory
}

export interface VExecutionGroup extends FlatEntry {
	allocate?: string
}

/**
 *  Representation of a MSE show.
 */
export interface VShow extends FlatEntry {
	/** UUID that identifies a show. */
	id: string // known as name
	// TOOD add other show details
	// available
	// loaded
	// has_loaded_error
}

/**
 *  Representation of a MSE playlist.
 */
export interface VPlaylist extends FlatEntry {
	name: string
	description?: string
	profile: string
	active_profile: { value?: string }
	// TODO add other details
	// modified
	// profile
	// settings
}

/**
 *  Representation of a Media Sequencer Engine.
 *
 *  Implementations of this interface are expected to hold minimal state, requesting
 *  information from an MSE when it is required. Users of this interface should be
 *  aware that every call may take some time to complete.
 *
 *  [[VRundown|Rundowns]] are a v-connection concept held as special playlists
 *  in the MSE with a sub-element called `sofie_show`. It is safe to have more than
 *  one instance of a rundown or set up distributed access to a rundown.
 */
export interface MSE extends EventEmitter {
	/** Hostname or IP address for the MSE. */
	readonly hostname: string
	/** Port for HTTP commands to the MSE. */
	readonly restPort: number
	/** Websocket port for PepTalk communication with the MSE. */
	readonly wsPort: number
	/**
	 *  Retrieve the details and controls for all Sofie rundowns of this MSE.
	 *  @returns List of rundowns for this MSE.
	 */
	getRundowns(): Promise<VRundown[]>
	/**
	 *  Retrieve the details and controls for a single Sofie rundown.
	 *  @param playlistID Identifier of the playlist associated with the requested
	 *                    rundown.
	 *  @return Rundown with the given identifier.
	 */
	getRundown(playlistID: string): Promise<VRundown>
	/**
	 * Retrieve a list of all Viz Engines with handlers at this MSE.
	 * @returns Resolves to a list of Viz Engine handlers for this MSE.
	 */
	getEngines(): Promise<VizEngine[]>
	/**
	 *  List the names of all the profiles for this MSE.
	 *  @returns List of the names of all the profiles known to this MSE.
	 */
	listProfiles(): Promise<string[]>
	/**
	 *  Retrieve the details of a specific profile at this MSE.
	 *  @param profileName Name of the profile to query.
	 *  @returns Resolves to the details of the named profile.
	 */
	getProfile(profileName: string): Promise<VProfile>
	/**
	 *  List the shows stored for this MSE.
	 *  @returns List of all the shows stored for this MSE.
	 */
	listShows(): Promise<string[]>
	/**
	 *  Retrieve details of a specific show as stored at this MSE.
	 *  @param showName Name of the show to query, a UUID.
	 *  @returns Resolves to the details of the named show.
	 */
	getShow(showName: string): Promise<VShow>
	/**
	 *  List the playlists stored for this MSE.
	 *  @returns Resolves to a list of playlists stored for this MSE.
	 */
	listPlaylists(): Promise<string[]>
	/**
	 *  Retrieve details of a specific playlist as stored at this MSE.
	 *  @param playlistName Name or UUID of a playlist to query.
	 *  @returns Resolves to the details of the named playlist.
	 */
	getPlaylist(playlistName: string): Promise<VPlaylist>
	/**
	 *  Create a new rundown to be executed on this MSE.
	 *  @param showID       Identifier of the show to create.
	 *  @param profileName  Name of the profile to send commands to.
	 *  @param playlistID   Optional UUID identifier for the playlist. If none is
	 *                      provided, one will be generated.
	 *  @param description  Optional rundown description. Used as a name in Viz
	 *                      Content Pilot.
	 *  @return Resolves to a newly created rundown.
	 */
	createRundown(showID: string, profile: string, playlistID?: string, description?: string): Promise<VRundown>
	/**
	 *  Delete a rundown from this MSE. Note that rundowns can only be deleted when
	 *  they are not activated.
	 *  @param rundown Rundown to be deleted.
	 *  @returns Was the delete operation successful?
	 */
	deleteRundown(rundown: VRundown): Promise<boolean>
	/**
	 *  Create a new profile for this MSE. A profile associated a show with the
	 *  Vix Engine handlers that it controls, representing the current state of
	 *  a rundown.
	 *  @param profileName Name of the profile to create.
	 *  @param profileDetailsTbc TODO
	 *  @returns Resolves to provide details of the newly created profile.
	 */
	createProfile(profileName: string, profileDetailsTbc: any): Promise<VProfile>
	/**
	 *  Delete a profile fot this MSE. A profile cannot be deleted if an
	 *  associated rundown is active.
	 *  @param profileName Name of the profile to delete.
	 *  @returns Resolves `true` on successful deletion of the profile, or `false` if
	 *           the profile does not exist.
	 */
	deleteProfile(profileName: string): Promise<boolean>
	/**
	 *  Check the status of PepTalk websocket and HTTP API connections to the MSE.
	 *  @returns Resolves if both connections were successful.
	 */
	ping(): Promise<CommandResult>
	/**
	 *  Set the maximum amount of time that an operation can take.
	 *  @param t Maximum number of milliseconds for any operation. Omit for query.
	 *  @return Timeeout value set. May be different from request if outside range.
	 */
	timeout(t?: number): number
	/**
	 *  Close all connections and release any resouces.
	 *  @returns Resolves to true on success.
	 */
	close(): Promise<boolean>
	// Not creating shows - leave that to trio
	// Add methods here for MSE configuration
	/** Add a listener for all non-error messages and events from the server. */
	on(event: 'connected', listener: () => void): this
	/** Add a listener for all error messages from the server. */
	on(event: 'disconnected', listener: (err?: Error) => void): this
}
